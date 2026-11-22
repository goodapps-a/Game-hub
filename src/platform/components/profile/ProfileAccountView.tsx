import React from 'react';
import { AuthUserSummary, PendingAuthUrlAction } from '../../auth/authClient';
import { UserProfile } from '../../types/platform';
import { AccountAuthPanel } from '../AccountAuthPanel';

interface ProfileAccountViewProps {
  profile: UserProfile;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
  pendingAuthAction?: PendingAuthUrlAction | null;
  onClearPendingAuthAction?: () => void;
}

const PRIVACY_TOGGLES = [
  {
    key: 'showOnlineStatus',
    title: 'نمایش وضعیت آنلاین',
    desc: 'نمایش وضعیت حضور در فهرست دوستان',
  },
  {
    key: 'allowFriendRequests',
    title: 'پذیرش لینک دعوت و دوستی',
    desc: 'اجازه افزودن از طریق لینک دعوت اختصاصی شما',
  },
  {
    key: 'compactProfileStats',
    title: 'نمایش خلاصه آمار',
    desc: 'نمایش فشرده‌تر اطلاعات در نمایه کاربری',
  },
] as const;

export const ProfileAccountView: React.FC<ProfileAccountViewProps> = ({
  profile,
  onUpdateProfile,
  authUser,
  authLoading,
  onAuthChange,
  pendingAuthAction = null,
  onClearPendingAuthAction,
}) => {
  return (
    <div className="space-y-4" data-testid="profile-account-view">
      {/* Preserved C1 & C2 Central Authentication Panel */}
      <AccountAuthPanel
        authUser={authUser}
        authLoading={authLoading}
        onAuthChange={onAuthChange}
        pendingAuthAction={pendingAuthAction}
        onClearPendingAuthAction={onClearPendingAuthAction}
      />

      {/* Account Privacy Controls */}
      <section className="space-y-2.5">
        <h3 className="text-xs sm:text-sm font-extrabold theme-heading px-0.5">
          حریم خصوصی و تعامل
        </h3>

        <div className="rounded-2xl theme-subcard border overflow-hidden divide-y divide-[var(--eyvan-line)]">
          {PRIVACY_TOGGLES.map((item) => {
            const checked = profile.accountSettings[item.key];
            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3 px-4 py-3.5 min-h-[60px]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold theme-heading">
                    {item.title}
                  </div>
                  <div className="text-[11px] theme-muted mt-0.5 leading-relaxed">
                    {item.desc}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  aria-label={item.title}
                  onClick={() => {
                    onUpdateProfile((prev) => ({
                      ...prev,
                      accountSettings: {
                        ...prev.accountSettings,
                        [item.key]: !prev.accountSettings[item.key],
                      },
                    }));
                  }}
                  className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
                    checked
                      ? 'bg-[#0D8A8A] justify-start'
                      : 'bg-[#64748B] justify-end'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
