import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, X } from 'lucide-react';
import { AuthUserSummary, PendingAuthUrlAction } from '../auth/authClient';
import { UserProfile } from '../types/platform';
import { ProfileAccountView } from './profile/ProfileAccountView';
import { ProfileEditView } from './profile/ProfileEditView';
import { ProfileOverview, ProfileSubView } from './profile/ProfileOverview';
import { ProfileSettingsView } from './profile/ProfileSettingsView';

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
}

const VIEW_TITLES: Record<ProfileSubView, string> = {
  overview: 'پروفایل کاربری',
  edit: 'ویرایش پروفایل',
  account: 'امنیت و حساب کاربری',
  settings: 'تنظیمات برنامه',
};

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
}) => {
  const [view, setView] = useState<ProfileSubView>('overview');
  const reducedMotion = profile.appSettings.reducedMotion;

  useEffect(() => {
    if (!isOpen) return;
    if (pendingAuthAction) {
      setView('account');
    } else {
      setView('overview');
    }
  }, [isOpen, pendingAuthAction]);

  // Body scroll lock & Escape key handling while Profile panel is open
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const isSubView = view !== 'overview';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.16 }}
          className="fixed inset-0 z-50 flex justify-start bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-label={VIEW_TITLES[view]}
          data-testid="profile-drawer"
        >
          {/* Backdrop click-outside target on desktop */}
          <div
            className="hidden md:block fixed inset-0"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Mobile: Full-Screen Panel | Desktop: Right-Docked Drawer */}
          <motion.aside
            initial={reducedMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reducedMotion ? { opacity: 1 } : { x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{
              duration: reducedMotion ? 0.01 : 0.22,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="relative z-10 w-full h-[100dvh] md:w-[440px] lg:w-[468px] md:max-w-[92vw] theme-drawer md:border-l md:border-[var(--eyvan-line)] md:shadow-[-16px_0_48px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden"
          >
            {/* Sticky Header with predictable Back / Close */}
            <header className="sticky top-0 z-20 min-h-[56px] px-4 sm:px-5 py-2.5 border-b border-[var(--eyvan-line)] theme-drawer flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {isSubView && (
                  <button
                    type="button"
                    data-testid="profile-back-btn"
                    onClick={() => setView('overview')}
                    aria-label="بازگشت به پروفایل"
                    className="min-w-[44px] min-h-[44px] -mr-2 rounded-xl flex items-center justify-center theme-heading hover:bg-black/5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </button>
                )}
                <h2 className="text-base font-extrabold theme-heading truncate">
                  {VIEW_TITLES[view]}
                </h2>
              </div>

              <button
                type="button"
                data-testid="profile-close-btn"
                onClick={onClose}
                aria-label="بستن پروفایل"
                className="min-w-[44px] min-h-[44px] -ml-2 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {view === 'overview' && (
                <ProfileOverview
                  profile={profile}
                  authUser={authUser}
                  onNavigate={setView}
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
