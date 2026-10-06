import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'promotion', String(context.params.id));
