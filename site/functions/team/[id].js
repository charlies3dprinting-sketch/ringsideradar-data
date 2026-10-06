import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'team', String(context.params.id));
