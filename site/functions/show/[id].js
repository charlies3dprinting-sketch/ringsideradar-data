import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'show', String(context.params.id));
