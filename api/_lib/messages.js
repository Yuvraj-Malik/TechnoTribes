// Who an owner message goes to. Kept free of database code so it can be unit tested.
import { HttpError } from './errors.js';

// to: 'all', or the user id of one admin.
export function resolveRecipients(to, adminIds) {
  if (!adminIds.length) throw new HttpError(400, 'This project has no admins yet');
  if (to === 'all') return adminIds;
  if (!adminIds.includes(to)) throw new HttpError(400, 'Choose an active admin on this project');
  return [to];
}
