import { db } from './db';
import { magicLinks, sessions, users } from './db/schema';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { MAGIC_LINK_RESEND_COOLDOWN_MS, MAGIC_LINK_TTL_MS, SESSION_TTL_MS } from '$lib/constants';
import { randomToken } from '$lib/utils';
import type { User } from '$lib/types';

// Returns null if a link was already requested for this email within the cooldown window,
// so the caller can show "please wait" instead of silently resending. `redirectTo` (e.g. an
// album invite path) rides along on the link itself, since the email round-trip is the only
// way to carry state from "clicked sign in" to "session created" here.
export async function createMagicLink(
	email: string,
	redirectTo: string | null = null
): Promise<string | null> {
	const mostRecent = await db.query.magicLinks.findFirst({
		where: eq(magicLinks.email, email),
		orderBy: desc(magicLinks.createdAt)
	});
	if (mostRecent && Date.now() - mostRecent.createdAt < MAGIC_LINK_RESEND_COOLDOWN_MS) return null;

	const token = randomToken();
	await db.insert(magicLinks).values({
		token,
		email,
		createdAt: Date.now(),
		expiresAt: Date.now() + MAGIC_LINK_TTL_MS,
		redirectTo
	});
	return token;
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
