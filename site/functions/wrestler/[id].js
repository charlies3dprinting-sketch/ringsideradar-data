import { preview } from '../../lib/preview.js';
export const onRequestGet = (context) => preview(context, 'wrestler', String(context.params.id));
