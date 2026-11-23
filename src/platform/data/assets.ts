import backdropImg from '../../assets/images/opt/backdrop.jpg';
import hokmHeroImg from '../../assets/images/opt/hokm_hero.jpg';
import hokmHeroLightImg from '../../assets/images/opt/hokm_hero_light.jpg';
import chessArtImg from '../../assets/images/opt/chess.jpg';
import chessArtLightImg from '../../assets/images/opt/chess_light.jpg';
import backgammonArtImg from '../../assets/images/opt/backgammon.jpg';
import backgammonArtLightImg from '../../assets/images/opt/backgammon_light.jpg';
import ludoArtImg from '../../assets/images/opt/ludo.jpg';
import ludoArtLightImg from '../../assets/images/opt/ludo_light.jpg';
import pasoorArtImg from '../../assets/images/opt/pasoor.jpg';
import pasoorArtLightImg from '../../assets/images/opt/pasoor_light.jpg';
import hokmTableTraditionalImg from '../../assets/images/opt/hokm_table_emerald_pro.jpg';
import hokmTableLapisImg from '../../assets/images/opt/hokm_table_lapis.jpg';
import hokmTableRubyImg from '../../assets/images/opt/hokm_table_ruby.jpg';
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

import profileBannerRoyalImg from '../../assets/images/opt/profile_banner_royal.jpg';
import profileBannerGardenImg from '../../assets/images/opt/profile_banner_garden.jpg';
import profileBannerRubyImg from '../../assets/images/opt/profile_banner_ruby.jpg';

/**
 * Static visual asset registry for the Eyvan platform & games.
 * All heavy artworks are served from optimized retina assets in /opt/.
 */
export const PLATFORM_ASSETS = {
  backdrop: backdropImg,
  hokmHero: hokmHeroImg,
  hokmHeroLight: hokmHeroLightImg,
  profileBannerRoyal: profileBannerRoyalImg,
  profileBannerGarden: profileBannerGardenImg,
  profileBannerRuby: profileBannerRubyImg,
  chessArt: chessArtImg,
  chessArtLight: chessArtLightImg,
  backgammonArt: backgammonArtImg,
  backgammonArtLight: backgammonArtLightImg,
  ludoArt: ludoArtImg,
  ludoArtLight: ludoArtLightImg,
  pasoorArt: pasoorArtImg,
  pasoorArtLight: pasoorArtLightImg,
  hokmTableTraditional: hokmTableTraditionalImg,
  hokmTableLapis: hokmTableLapisImg,
  hokmTableRuby: hokmTableRubyImg,
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

/**
 * Persistent in-memory decoded image cache so switching tabs, opening modals,
 * or toggling Dark/Light mode NEVER re-downloads or flashes images from scratch.
 */
const decodedAssetCache = new Map<string, HTMLImageElement>();
let secondaryPreloadScheduled = false;

export function preloadImageUrls(urls: readonly string[]): void {
  if (typeof window === 'undefined') return;
  for (const url of urls) {
    if (!url || decodedAssetCache.has(url)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    decodedAssetCache.set(url, img);
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {
        // Non-fatal decode error
      });
    }
  }
}

export function preloadPlatformAssets(themeMode: 'dark' | 'light' = 'dark'): void {
  if (typeof window === 'undefined') return;

  // 1. Immediately warm ONLY the active-theme home cards (keeps first load ultra-fast)
  const primaryHomeUrls =
    themeMode === 'light'
      ? [
          PLATFORM_ASSETS.hokmHeroLight,
          PLATFORM_ASSETS.chessArtLight,
          PLATFORM_ASSETS.backgammonArtLight,
          PLATFORM_ASSETS.ludoArtLight,
          PLATFORM_ASSETS.pasoorArtLight,
          PLATFORM_ASSETS.userAvatar,
        ]
      : [
          PLATFORM_ASSETS.backdrop,
          PLATFORM_ASSETS.hokmHero,
          PLATFORM_ASSETS.chessArt,
          PLATFORM_ASSETS.backgammonArt,
          PLATFORM_ASSETS.ludoArt,
          PLATFORM_ASSETS.pasoorArt,
          PLATFORM_ASSETS.userAvatar,
        ];
  preloadImageUrls(primaryHomeUrls);

  // 2. Lazily warm secondary artworks (opposite theme, shop chests, banners) only after idle
  if (secondaryPreloadScheduled) return;
  secondaryPreloadScheduled = true;

  const warmSecondary = () => {
    preloadImageUrls(Object.values(PLATFORM_ASSETS));
  };

  const scheduleIdle = () => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(warmSecondary, { timeout: 4500 });
    } else {
      window.setTimeout(warmSecondary, 2600);
    }
  };

  if (document.readyState === 'complete') {
    window.setTimeout(scheduleIdle, 900);
  } else {
    window.addEventListener('load', () => window.setTimeout(scheduleIdle, 900), {
      once: true,
    });
  }
}
