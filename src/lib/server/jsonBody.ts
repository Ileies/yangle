import { error } from '@sveltejs/kit';
import type { z } from 'zod';

export async function parseJsonBody<T extends z.ZodType>(
	request: Request,
	schema: T,
	message: string
): Promise<z.output<T>> {
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const result = schema.safeParse(value);
	if (!result.success) error(400, message);
	return result.data;
}
