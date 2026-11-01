import { randomInt, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { magicLinks, sessions, users } from './db/schema';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import {
	LOGIN_CODE_LENGTH,
	LOGIN_CODE_MAX_ATTEMPTS,
	MAGIC_LINK_RESEND_COOLDOWN_MS,
	MAGIC_LINK_TTL_MS,
	SESSION_TTL_MS
} from '#lib/constants.js';
import { randomToken } from '#lib/utils.js';
import type { User } from '#lib/types.js';

function randomLoginCode(): string {
	return randomInt(0, 10 ** LOGIN_CODE_LENGTH)
		.toString()
		.padStart(LOGIN_CODE_LENGTH, '0');
}

export type CreatedMagicLink = { token: string; code: string };

// Returns null if a link was already requested for this email within the cooldown window,
// so the caller can show "please wait" instead of silently resending. `redirectTo` (e.g. an
// album invite path) rides along on the link itself, since the email round-trip is the only
// way to carry state from "clicked sign in" to "session created" here. The same row also
// holds a short code, for signing in on a different device than the one the email is read on.
export async function createMagicLink(
	email: string,
	redirectTo: string | null = null
): Promise<CreatedMagicLink | null> {
	const mostRecent = await db.query.magicLinks.findFirst({
		where: eq(magicLinks.email, email),
		orderBy: desc(magicLinks.createdAt)
	});
	if (mostRecent && Date.now() - mostRecent.createdAt < MAGIC_LINK_RESEND_COOLDOWN_MS) return null;

	const token = randomToken();
	const code = randomLoginCode();
	await db.insert(magicLinks).values({
		token,
		email,
		code,
		createdAt: Date.now(),
		expiresAt: Date.now() + MAGIC_LINK_TTL_MS,
		redirectTo
	});
	return { token, code };
}

export type ConsumedMagicLink = { sessionToken: string; redirectTo: string | null };

// Consumes the link (one-time use) and returns the new session, creating the user on first
// login. Returns null if the link is missing, used or expired.
export async function consumeMagicLink(token: string): Promise<ConsumedMagicLink | null> {
	const link = await db.query.magicLinks.findFirst({
		where: and(
			eq(magicLinks.token, token),
			isNull(magicLinks.consumedAt),
			gt(magicLinks.expiresAt, Date.now())
		)
	});
	if (!link) return null;

	return completeLogin(link);
}

// Same as `consumeMagicLink`, but identified by the code from the email instead of the link.
// Only the most recent live link for the email is eligible (requesting a new link supersedes
// the code in the old email). Every guess is counted before it's compared, in one atomic
// UPDATE, so parallel guesses can't squeeze extra attempts past `LOGIN_CODE_MAX_ATTEMPTS`.
export async function consumeLoginCode(
	email: string,
	code: string
): Promise<ConsumedMagicLink | null> {
	const live = await db.query.magicLinks.findFirst({
		where: and(
			eq(magicLinks.email, email),
			isNull(magicLinks.consumedAt),
			gt(magicLinks.expiresAt, Date.now())
		),
		orderBy: desc(magicLinks.createdAt)
	});
	if (!live) return null;

	const link = await db
		.update(magicLinks)
		.set({ codeAttempts: sql`${magicLinks.codeAttempts} + 1` })
		.where(
			and(
				eq(magicLinks.token, live.token),
				isNull(magicLinks.consumedAt),
				lt(magicLinks.codeAttempts, LOGIN_CODE_MAX_ATTEMPTS)
			)
		)
		.returning()
		.get();
	if (!link?.code) return null;

	const expected = Buffer.from(link.code);
	const given = Buffer.from(code);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

	return completeLogin(link);
}

async function completeLogin(link: typeof magicLinks.$inferSelect): Promise<ConsumedMagicLink> {
	await db
		.update(magicLinks)
		.set({ consumedAt: Date.now() })
		.where(eq(magicLinks.token, link.token));

	await db
		.insert(users)
		.values({
			email: link.email,
			displayName: link.email.split('@')[0],
			createdAt: Date.now()
		})
		.onConflictDoNothing();

	const sessionToken = await createSession(link.email);
	return { sessionToken, redirectTo: link.redirectTo };
}

export async function createSession(email: string): Promise<string> {
	const token = randomToken();
	await db.insert(sessions).values({
		token,
		email,
		createdAt: Date.now(),
		expiresAt: Date.now() + SESSION_TTL_MS
	});
	return token;
}

export async function getSessionUser(token: string): Promise<User | null> {
	const row = await db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.email, users.email))
		.where(and(eq(sessions.token, token), gt(sessions.expiresAt, Date.now())))
		.get();

	return row?.user ?? null;
}

export async function destroySession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.token, token));
}

export async function destroyAllSessions(email: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.email, email));
}

export async function updateDisplayName(email: string, displayName: string): Promise<void> {
	await db.update(users).set({ displayName }).where(eq(users.email, email));
}
