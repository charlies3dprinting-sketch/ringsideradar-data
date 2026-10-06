import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'fan', String(context.params.username));
