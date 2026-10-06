import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'group', String(context.params.id));
