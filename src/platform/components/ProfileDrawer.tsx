import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Shield, Sliders, User, X } from 'lucide-react';
import { AuthUserSummary, PendingAuthUrlAction } from '../auth/authClient';
import { UserProfile } from '../types/platform';
import { ProfileAccountView } from './profile/ProfileAccountView';
import { ProfileEditView } from './profile/ProfileEditView';
import { ProfileOverview, ProfileSubView } from './profile/ProfileOverview';
import { ProfileSettingsView } from './profile/ProfileSettingsView';

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
}

const TOP_TABS: ReadonlyArray<{
  id: Exclude<ProfileSubView, 'edit'>;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'پروفایل', icon: User },
  { id: 'account', label: 'حساب و امنیت', icon: Shield },
  { id: 'settings', label: 'تنظیمات', icon: Sliders },
];

/**
 * Floating Centered Profile Modal (never full-screen).
 * Displays the player's customizable banner, avatar, stats, and settings cleanly.
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
}) => {
  const [view, setView] = useState<ProfileSubView>(initialView);
  const [authModeRequest, setAuthModeRequest] =
    useState<ProfileInitialAuthMode>(initialAuthMode);
  const reducedMotion = profile.appSettings.reducedMotion;

  useEffect(() => {
    if (!isOpen) return;
    if (pendingAuthAction) {
      setView('account');
    } else {
      setView(initialView);
      setAuthModeRequest(initialAuthMode);
    }
  }, [isOpen, pendingAuthAction, initialView, initialAuthMode]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'edit') {
          setView('overview');
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
  }, [isOpen, onClose, view]);

  const handleRequestAuth = (mode: ProfileInitialAuthMode) => {
    if (onOpenAuthModal) {
      onClose();
      onOpenAuthModal(mode);
      return;
    }
    setAuthModeRequest(mode);
    setView('account');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/68 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="پروفایل کاربری ایوان"
          data-testid="profile-drawer"
        >
          {/* Backdrop click-outside target (both mobile & desktop) */}
          <div
            className="fixed inset-0"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Centered Floating Profile Card */}
          <motion.aside
            initial={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, y: 14 }
            }
            animate={
              reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
            }
            exit={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.95, y: 10 }
            }
            transition={{
              duration: reducedMotion ? 0.01 : 0.22,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="relative z-10 w-full max-w-[468px] max-h-[88dvh] rounded-[26px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_72px_rgba(0,0,0,0.52)] flex flex-col overflow-hidden"
          >
            {/* Compact Sticky Header */}
            <header className="sticky top-0 z-20 px-4 sm:px-5 pt-3 pb-2.5 border-b border-[var(--eyvan-line)] theme-drawer space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2 min-h-[38px]">
                <h2 className="text-sm sm:text-base font-black theme-heading truncate">
                  {view === 'edit' ? 'ویرایش پروفایل' : 'پروفایل بازیکن'}
                </h2>

                <div className="flex items-center gap-1 shrink-0">
                  {view === 'edit' && (
                    <button
                      type="button"
                      data-testid="profile-back-btn"
                      onClick={() => setView('overview')}
                      aria-label="بازگشت به پروفایل"
                      className="min-h-[36px] px-2.5 rounded-xl inline-flex items-center gap-1 text-xs font-extrabold theme-heading hover:bg-black/5 cursor-pointer transition-colors"
                    >
                      <span>بازگشت</span>
                      <ArrowLeft className="w-4 h-4 shrink-0" />
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="profile-close-btn"
                    onClick={onClose}
                    aria-label="بستن پروفایل"
                    className="min-w-[38px] min-h-[38px] -ml-1.5 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Clean Segmented Tabs inside Floating Profile */}
              {view !== 'edit' && (
                <div
                  role="tablist"
                  aria-label="بخش‌های پروفایل"
                  className="grid grid-cols-3 gap-1 p-1 rounded-xl theme-tab-track"
                >
                  {TOP_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = view === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-drawer-nav={tab.id}
                        onClick={() => setView(tab.id)}
                        className={`min-h-[38px] px-2 rounded-lg text-xs font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                          active
                            ? 'bg-[var(--eyvan-card-bg)] theme-heading shadow-xs border border-[var(--eyvan-gold)]/40'
                            : 'theme-muted hover:text-[var(--eyvan-text)]'
                        }`}
                      >
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            active ? 'theme-accent-gold' : ''
                          }`}
                        />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </header>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 sm:py-5">
              {view === 'overview' && (
                <ProfileOverview
                  profile={profile}
                  authUser={authUser}
                  onUpdateProfile={onUpdateProfile}
                  onNavigate={setView}
                  onOpenAuth={handleRequestAuth}
                  onOpenBannerShop={onOpenBannerShop}
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

              {view === 'account' && (
                <ProfileAccountView
                  profile={profile}
                  onUpdateProfile={onUpdateProfile}
                  authUser={authUser}
                  authLoading={authLoading}
                  onAuthChange={onAuthChange}
                  pendingAuthAction={pendingAuthAction}
                  onClearPendingAuthAction={onClearPendingAuthAction}
                  initialAuthMode={authModeRequest}
                />
              )}

              {view === 'settings' && (
                <ProfileSettingsView
                  profile={profile}
                  onUpdateProfile={onUpdateProfile}
                />
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
