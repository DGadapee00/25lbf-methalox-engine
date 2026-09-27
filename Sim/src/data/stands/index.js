/** Stand configurations by id (#/stand/<id>). Each builds a pure-data stand from components.json. */
import { gn2Coldflow } from './gn2Coldflow.js';
import { fullStand } from './fullStand.js';
import { hotFire } from './hotFire.js';

export const STANDS = {
  'gn2-coldflow': gn2Coldflow,
  'full-stand': fullStand,
  'hot-fire': hotFire,
};
