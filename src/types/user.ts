import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Username must start with a letter and contain only letters, digits, hyphens, and underscores',
  );

export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters');

export const SlackUserIdSchema = z
  .string()
  .regex(/^U[A-Z0-9]+$/, 'Invalid Slack user ID format');

export const CreateUserInputSchema = z
  .object({
    slackId: SlackUserIdSchema.optional(),
    username: UsernameSchema.optional(),
    password: PasswordSchema.optional(),
    displayName: z.string().min(1).max(200).optional(),
    role: UserRoleSchema.default('user'),
  })
  .refine(
    (input) => input.slackId !== undefined || input.username !== undefined,
    { message: 'At least one of slackId or username is required' },
  )
  .refine(
    (input) => input.username === undefined || input.password !== undefined,
    { message: 'Password is required when username is provided' },
  );

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export interface User {
  id: number;
  slackId: string | null;
  username: string | null;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateProfileInput {
  displayName?: string | null;
  slackId?: string | null;
  username?: string | null;
}
