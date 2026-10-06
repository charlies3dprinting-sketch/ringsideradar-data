import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'title', String(context.params.id));
