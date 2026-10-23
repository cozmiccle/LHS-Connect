import { object, type ObjectSchema, string } from 'yup';
import type { IContactUsMessage } from './types';

export const contactUsValidator: ObjectSchema<IContactUsMessage> = object({
	name: string().trim().max(256).label('Name'),
	type: string().trim().required().max(256).label('Type'),
	email: string()
		.trim()
		.email()
		.max(256)
		.label('Email')
		// We need a way to reply with the invite, so Discord requests must include an email
		.when('type', { is: 'discord', then: (schema) => schema.required() }),
	message: string().trim().required().max(1024).label('Message'),
});

// Same as above, but the email is always required. The form validates one field at a time,
// so the email field uses this when the request is for Discord access
export const discordRequestValidator: ObjectSchema<IContactUsMessage> = contactUsValidator.shape({
	email: string().trim().email().required().max(256).label('Email'),
});
