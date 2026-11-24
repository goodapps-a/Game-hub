import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Settings, X } from 'lucide-react';
import { AuthUserSummary, PendingAuthUrlAction } from '../auth/authClient';
import { UserProfile } from '../types/platform';
import { ProfileEditView } from './profile/ProfileEditView';
import { ProfileOverview, ProfileSubView } from './profile/ProfileOverview';
import {
  ProfileSettingsView,
  SETTINGS_SECTION_TITLES,
  SettingsSectionId,
} from './profile/ProfileSettingsView';

export type ProfileInitialAuthMode = 'login' | 'register';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
  pendingAuthAction?: PendingAuthUrlAction | null;
  onClearPendingAuthAction?: () => void;
  initialView?: ProfileSubView;
  initialAuthMode?: ProfileInitialAuthMode;
  onOpenAuthModal?: (mode: ProfileInitialAuthMode) => void;
  onOpenBannerShop?: () => void;
  onOpenTopUpShop?: () => void;
}

/**
 * Full-Screen Own Profile & Grouped Settings Experience (Screenshots 1 & 2).
 * - Clean top bar: Back/Close button, dead-centered title, and Settings Gear icon on overview.
 * - Zero top 3 segmented tabs; Settings opens Screenshot 1's grouped rows.
 */
export const ProfileDrawer: React.FC<ProfileDrawerProps> = ({
  isOpen,
  onClose,
  profile,
  onUpdateProfile,
  authUser,
  authLoading,
  onAuthChange,
  pendingAuthAction = null,
  onClearPendingAuthAction,
  initialView = 'overview',
  initialAuthMode = 'login',
  onOpenAuthModal,
  onOpenBannerShop,
  onOpenTopUpShop,
}) => {
  const [view, setView] = useState<'overview' | 'edit' | 'settings'>('overview');
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId | null>(null);
  const [authModeRequest, setAuthModeRequest] =
    useState<ProfileInitialAuthMode>(initialAuthMode);
  const reducedMotion = profile.appSettings.reducedMotion;

  useEffect(() => {
    if (!isOpen) return;
    setAuthModeRequest(initialAuthMode);
    if (pendingAuthAction || initialView === 'account') {
      setView('settings');
      setSettingsSection('account');
    } else if (initialView === 'settings') {
      setView('settings');
      setSettingsSection(null);
    } else if (initialView === 'edit') {
      setView('edit');
      setSettingsSection(null);
    } else {
      setView('overview');
      setSettingsSection(null);
    }
  }, [isOpen, pendingAuthAction, initialView, initialAuthMode]);

  const handleHeaderBack = () => {
    if (view === 'settings' && settingsSection !== null) {
      setSettingsSection(null);
      return;
    }
    if (view === 'settings' || view === 'edit') {
      setView('overview');
      setSettingsSection(null);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'settings' && settingsSection !== null) {
          setSettingsSection(null);
        } else if (view !== 'overview') {
          setView('overview');
          setSettingsSection(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, settingsSection, view]);

  const handleNavigateFromOverview = (next: ProfileSubView) => {
    if (next === 'account') {
      setView('settings');
      setSettingsSection('account');
    } else if (next === 'settings') {
      setView('settings');
      setSettingsSection(null);
    } else {
      setView(next);
      setSettingsSection(null);
    }
  };

  const handleRequestAuth = (mode: ProfileInitialAuthMode) => {
    if (onOpenAuthModal) {
      onClose();
      onOpenAuthModal(mode);
      return;
    }
    setAuthModeRequest(mode);
    setView('settings');
    setSettingsSection('account');
  };

  const headerTitle =
    view === 'edit'
      ? 'ویرایش پروفایل'
      : view === 'settings'
        ? settingsSection
          ? SETTINGS_SECTION_TITLES[settingsSection]
          : 'تنظیمات'
        : 'پروفایل من';

  const isRootOverview = view === 'overview';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={reducedMotion ? false : { y: 18 }}
          animate={{ y: 0 }}
          exit={reducedMotion ? undefined : { y: 20 }}
          transition={{
            duration: reducedMotion ? 0.01 : 0.22,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="fixed inset-0 z-50 theme-drawer flex flex-col overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="پروفایل کاربری ایوان"
          data-testid="profile-drawer"
        >
          {/* Clean Full-Screen Sticky Header (Back/Close + Dead-Centered Title + Settings Gear) */}
          <header className="sticky top-0 z-20 px-4 sm:px-6 h-14 border-b border-[var(--eyvan-line)] theme-drawer grid grid-cols-[44px_1fr_44px] items-center shrink-0">
            <div className="flex items-center justify-start">
              {isRootOverview ? (
                <button
                  type="button"
                  data-testid="profile-close-btn"
                  onClick={onClose}
                  aria-label="بستن پروفایل"
                  className="w-10 h-10 rounded-xl flex items-center justify-center theme-heading hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="profile-back-btn"
                  onClick={handleHeaderBack}
                  aria-label="بازگشت"
                  className="w-10 h-10 rounded-xl flex items-center justify-center theme-heading hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </div>

            <h2 className="text-base sm:text-lg font-black theme-heading text-center truncate">
              {headerTitle}
            </h2>

            <div className="flex items-center justify-end">
              {isRootOverview ? (
                <button
                  type="button"
                  data-testid="profile-settings-gear-btn"
                  onClick={() => {
                    setView('settings');
                    setSettingsSection(null);
                  }}
                  aria-label="تنظیمات"
                  title="تنظیمات"
                  className="w-10 h-10 rounded-xl flex items-center justify-center theme-heading hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>
              ) : (
                <span className="w-10 h-10" aria-hidden="true" />
              )}
            </div>
          </header>

          {/* Scrollable Full-Screen Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 sm:py-6">
            {view === 'overview' && (
              <ProfileOverview
                profile={profile}
                authUser={authUser}
                onUpdateProfile={onUpdateProfile}
                onNavigate={handleNavigateFromOverview}
                onOpenAuth={handleRequestAuth}
                onOpenBannerShop={onOpenBannerShop}
                onOpenTopUpShop={onOpenTopUpShop}
              />
            )}

            {view === 'edit' && (
              <ProfileEditView
                profile={profile}
                authUser={authUser}
                onUpdateProfile={onUpdateProfile}
                onAuthChange={onAuthChange}
                onCancel={() => setView('overview')}
              />
            )}

            {view === 'settings' && (
              <ProfileSettingsView
                profile={profile}
                onUpdateProfile={onUpdateProfile}
                authUser={authUser}
                authLoading={authLoading}
                onAuthChange={onAuthChange}
                pendingAuthAction={pendingAuthAction}
                onClearPendingAuthAction={onClearPendingAuthAction}
                initialAuthMode={authModeRequest}
                activeSection={settingsSection}
                onSelectSection={setSettingsSection}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
