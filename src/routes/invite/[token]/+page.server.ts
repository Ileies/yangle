import { error, redirect } from '@sveltejs/kit';
import { getAlbumByInviteToken, getAlbumRole } from '$lib/server/albums';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const album = await getAlbumByInviteToken(params.token);
	if (!album || !album.inviteRole) error(404, 'This invite link is invalid or has been revoked');

	if (!locals.user) redirect(303, `/login?redirectTo=/invite/${params.token}`);

	const existingRole = await getAlbumRole(album.id, locals.user.email);
	return {
		album: { id: album.id, name: album.name },
		inviteRole: album.inviteRole,
		alreadyMember: existingRole !== null,
		token: params.token
	};
};
