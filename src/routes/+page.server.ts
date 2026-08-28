import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// No real homepage in the MVP - just route straight to what the user is here for.
export const load: PageServerLoad = async ({ locals }) => {
	redirect(303, locals.user ? '/albums' : '/login');
};
