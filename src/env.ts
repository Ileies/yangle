import { defineEnvVars } from '@sveltejs/kit/env';

const optionalString = (input: string | undefined) => input ?? '';

export const variables = defineEnvVars({
	DATA_DIR: { schema: optionalString },
	ORIGIN: { schema: optionalString },
	SMTP_FROM: { schema: optionalString },
	SMTP_HOST: { schema: optionalString },
	SMTP_PASS: { schema: optionalString },
	SMTP_PORT: { schema: optionalString },
	SMTP_USER: { schema: optionalString }
});
