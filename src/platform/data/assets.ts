import backdropImg from '../../assets/images/opt/backdrop.jpg';
import hokmHeroImg from '../../assets/images/opt/hokm_hero.jpg';
import chessArtImg from '../../assets/images/opt/chess.jpg';
import backgammonArtImg from '../../assets/images/opt/backgammon.jpg';
import ludoArtImg from '../../assets/images/opt/ludo.jpg';
import pasoorArtImg from '../../assets/images/opt/pasoor.jpg';
import hokmTableTraditionalImg from '../../assets/images/opt/hokm_table.jpg';
import shopChestGoldImg from '../../assets/images/opt/chest_gold.jpg';
import shopChestGemImg from '../../assets/images/opt/chest_gem.jpg';

import userAvatarImg from '../../assets/images/avatars/user.jpg';
import avatarParvinImg from '../../assets/images/avatars/parvin.jpg';
import avatarSohrabImg from '../../assets/images/avatars/sohrab.jpg';
import avatarFarhadImg from '../../assets/images/avatars/farhad.jpg';
import avatarNegarImg from '../../assets/images/avatars/negar.jpg';
import avatarKeyvanImg from '../../assets/images/avatars/keyvan.jpg';

import aceSpadesCardImg from '../../assets/images/cards/ace_spades.jpg';
import kingRedCardImg from '../../assets/images/cards/king_red.jpg';
import queenRedCardImg from '../../assets/images/cards/queen_red.jpg';
import jackRedCardImg from '../../assets/images/cards/jack_red.jpg';
import kingSpadesCardImg from '../../assets/images/cards/king_spades.jpg';
import kingClubsCardImg from '../../assets/images/cards/king_clubs.jpg';
import queenBlackCardImg from '../../assets/images/cards/queen_black.jpg';
import jackSpadesCardImg from '../../assets/images/cards/jack_spades.jpg';
import jackClubsCardImg from '../../assets/images/cards/jack_clubs.jpg';

/**
 * Static visual asset registry for the Eyvan platform & games.
 * Separated from demo user/chat data so real UI modules never import mock records.
 */
export const PLATFORM_ASSETS = {
  backdrop: backdropImg,
  hokmHero: hokmHeroImg,
  chessArt: chessArtImg,
  backgammonArt: backgammonArtImg,
  ludoArt: ludoArtImg,
  pasoorArt: pasoorArtImg,
  hokmTableTraditional: hokmTableTraditionalImg,
  shopChestGold: shopChestGoldImg,
  shopChestGem: shopChestGemImg,
  userAvatar: userAvatarImg,
  avatarParvin: avatarParvinImg,
  avatarSohrab: avatarSohrabImg,
  avatarFarhad: avatarFarhadImg,
  avatarNegar: avatarNegarImg,
  avatarKeyvan: avatarKeyvanImg,
} as const;

export const CARD_ART_ASSETS = {
  aceSpades: aceSpadesCardImg,
  kingRed: kingRedCardImg,
  queenRed: queenRedCardImg,
  jackRed: jackRedCardImg,
  kingSpades: kingSpadesCardImg,
  kingClubs: kingClubsCardImg,
  queenBlack: queenBlackCardImg,
  jackSpades: jackSpadesCardImg,
  jackClubs: jackClubsCardImg,
} as const;
