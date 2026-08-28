import nodemailer from 'nodemailer';
import {
	APP_URL,
	SMTP_FROM,
	SMTP_HOST,
	SMTP_PASS,
	SMTP_PORT,
	SMTP_USER
} from '$env/static/private';

const transporter = SMTP_HOST
	? nodemailer.createTransport({
			host: SMTP_HOST,
			port: Number(SMTP_PORT),
			secure: Number(SMTP_PORT) === 465,
			auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
		})
	: null;

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
	const link = `${APP_URL}/login/verify?token=${token}`;

	if (!transporter) {
		// No SMTP configured (local dev) - print the link instead of sending it.
		console.log(`[mail] magic link for ${email}: ${link}`);
		return;
	}

	await transporter.sendMail({
		from: SMTP_FROM,
		to: email,
		subject: 'Your Yangle login link',
		text: `Sign in to Yangle: ${link}\n\nThis link expires in 15 minutes.`,
		html: `<p><a href="${link}">Sign in to Yangle</a></p><p>This link expires in 15 minutes.</p>`
	});
}

// Notifies someone they've been given (email-based) access to an album - just a heads-up with
// a link to sign in, not itself the access grant (the `album_shares` row is already written by
// the time this is called; the recipient's magic link will land them straight on the album via
// its `redirectTo`, whether or not they've ever signed in before).
export async function sendAlbumShareEmail(
	email: string,
	albumName: string,
	inviterName: string
): Promise<void> {
	const link = `${APP_URL}/login`;

	if (!transporter) {
		console.log(`[mail] "${albumName}" shared with ${email} by ${inviterName}: ${link}`);
		return;
	}

	await transporter.sendMail({
		from: SMTP_FROM,
		to: email,
		subject: `${inviterName} shared "${albumName}" with you on Yangle`,
		text: `${inviterName} shared the album "${albumName}" with you on Yangle.\n\nSign in to view it: ${link}`,
		html: `<p>${inviterName} shared the album "${albumName}" with you on Yangle.</p><p><a href="${link}">Sign in to view it</a></p>`
	});
}
