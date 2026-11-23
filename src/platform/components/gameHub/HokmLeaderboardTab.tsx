import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Play, RefreshCw, Trophy } from 'lucide-react';
import {
  HokmLeaderboardRow,
  fetchHokmLeaderboard,
} from '../../../games/hokm/online/client';
import { getAvatarSrcByCode } from '../../../games/hokm/components/OnlineLobby';
import { toPersianDigits } from '../../theme/tokens';
import { rankLeaderboardEntries } from '../../utils/gameHubHelpers';

interface HokmLeaderboardTabProps {
  currentUserId?: string | null;
  onJumpToPlay: () => void;
}

const PODIUM_STYLES: Record<
  number,
  { ring: string; rankColor: string; label: string }
> = {
  1: {
    ring: 'border-[#D4AE58]/70 bg-[#D4AE58]/10',
    rankColor: 'theme-accent-gold',
    label: 'نفر اول',
  },
  2: {
    ring: 'border-[#94A3B8]/50 bg-[#94A3B8]/8',
    rankColor: 'theme-heading',
    label: 'نفر دوم',
  },
  3: {
    ring: 'border-[#CD7F32]/50 bg-[#CD7F32]/8',
    rankColor: 'text-[#B45309] dark:text-[#F59E0B]',
    label: 'نفر سوم',
  },
};

export const HokmLeaderboardTab: React.FC<HokmLeaderboardTabProps> = ({
  currentUserId = null,
  onJumpToPlay,
}) => {
  const [rows, setRows] = useState<HokmLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLeaderboard = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchHokmLeaderboard(20);
      setRows(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard(false);
  }, [loadLeaderboard]);

  const ranked = useMemo(() => rankLeaderboardEntries(rows), [rows]);
  const topThree = ranked.slice(0, 3);

  return (
    <div
      data-testid="hokm-leaderboard-tab"
      className="space-y-4"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-extrabold theme-heading">
            برترین بازیکنان حکم آنلاین
          </h2>
          <p className="text-xs theme-muted mt-0.5">
            رتبه‌بندی واقعی بر اساس بردها و امتیاز کُت در مسابقات آنلاین
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadLeaderboard(true)}
          disabled={loading || refreshing}
          data-testid="leaderboard-refresh-btn"
          className="min-h-[40px] px-3 rounded-xl theme-btn-secondary border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
          />
          <span>بروزرسانی</span>
        </button>
      </div>

      {loading ? (
        <div className="eyvan-card rounded-2xl p-5 space-y-3" aria-busy="true">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-12 rounded-xl bg-[var(--eyvan-surface-muted)] animate-pulse"
            />
          ))}
        </div>
      ) : ranked.length === 0 ? (
        <div
          data-testid="hokm-leaderboard-empty"
          className="eyvan-card rounded-2xl p-7 sm:p-9 text-center space-y-3.5"
        >
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] flex items-center justify-center">
            <Trophy className="w-6 h-6 theme-accent-gold" />
          </div>
          <div className="space-y-1 max-w-xs mx-auto">
            <h3 className="text-sm sm:text-base font-extrabold theme-heading">
              جدول برترین‌ها منتظر اولین قهرمان است
            </h3>
            <p className="text-xs theme-muted leading-relaxed">
              پس از پایان اولین مسابقه آنلاین حکم، رتبه و آمار واقعی بازیکنان اینجا ثبت می‌شود.
            </p>
          </div>
          <button
            type="button"
            onClick={onJumpToPlay}
            className="min-h-[44px] px-5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs sm:text-sm font-black inline-flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>شروع اولین بازی</span>
          </button>
        </div>
      ) : (
        <>
          {/* Top 3 Podium Cards */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {topThree.map((entry) => {
                const style = PODIUM_STYLES[entry.rank] ?? PODIUM_STYLES[3];
                const isMe = Boolean(currentUserId && entry.userId === currentUserId);
                return (
                  <div
                    key={entry.userId}
                    className={`eyvan-card rounded-2xl p-4 border flex sm:flex-col items-center sm:text-center gap-3 ${style.ring}`}
                  >
                    <div className="relative shrink-0">
                      <img
                        src={getAvatarSrcByCode(entry.avatarCode)}
                        alt={entry.username}
                        className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border border-[var(--eyvan-line)]"
                      />
                      <span
                        className={`absolute -top-2 -right-2 w-6 h-6 rounded-lg bg-[var(--eyvan-card-bg)] border border-[var(--eyvan-line)] flex items-center justify-center text-xs font-black tabular-nums ${style.rankColor}`}
                      >
                        {toPersianDigits(entry.rank)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 sm:w-full">
                      <div className="flex sm:justify-center items-center gap-1.5">
                        <span className="text-sm font-extrabold theme-heading truncate">
                          {entry.username}
                        </span>
                        {isMe && (
                          <span className="text-[11px] font-bold theme-accent-teal shrink-0">
                            (شما)
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] theme-muted mt-0.5">
                        {style.label} · {toPersianDigits(entry.winRatePct)}٪ برد
                      </p>
                    </div>

                    <div className="text-left sm:text-center sm:w-full sm:pt-2 sm:border-t sm:border-[var(--eyvan-line)] shrink-0">
                      <div className="text-base font-black theme-accent-gold tabular-nums">
                        {toPersianDigits(entry.wins)}{' '}
                        <span className="text-[11px] font-bold theme-muted">
                          برد
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Full Ranked Table */}
          <div className="eyvan-card rounded-2xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2.5 text-[11px] font-bold theme-muted border-b border-[var(--eyvan-line)] bg-[var(--eyvan-surface-muted)]/60">
              <span className="col-span-2 sm:col-span-1">رتبه</span>
              <span className="col-span-5 sm:col-span-5">بازیکن</span>
              <span className="col-span-2 text-center">برد</span>
              <span className="col-span-3 sm:col-span-2 text-center">نرخ برد</span>
              <span className="hidden sm:block sm:col-span-2 text-center">کُت</span>
            </div>

            <div className="divide-y divide-[var(--eyvan-line)]">
              {ranked.map((entry) => {
                const isMe = Boolean(currentUserId && entry.userId === currentUserId);
                const totalKots = entry.kotWins + entry.hakemKotWins;
                return (
                  <div
                    key={entry.userId}
                    className={`grid grid-cols-12 items-center px-4 py-3 text-xs sm:text-sm ${
                      isMe ? 'bg-[#0D8A8A]/10' : ''
                    }`}
                  >
                    <span className="col-span-2 sm:col-span-1 font-black tabular-nums theme-muted">
                      #{toPersianDigits(entry.rank)}
                    </span>
                    <div className="col-span-5 sm:col-span-5 flex items-center gap-2.5 min-w-0">
                      <img
                        src={getAvatarSrcByCode(entry.avatarCode)}
                        alt={entry.username}
                        className="w-8 h-8 rounded-xl object-cover border border-[var(--eyvan-line)] shrink-0"
                      />
                      <span className="font-extrabold theme-heading truncate">
                        {entry.username}
                      </span>
                      {isMe && (
                        <span className="text-[11px] font-bold theme-accent-teal shrink-0">
                          شما
                        </span>
                      )}
                    </div>
                    <span className="col-span-2 text-center font-extrabold theme-win tabular-nums">
                      {toPersianDigits(entry.wins)}
                      <span className="text-[10px] font-semibold theme-muted">
                        /{toPersianDigits(entry.matchesPlayed)}
                      </span>
                    </span>
                    <span className="col-span-3 sm:col-span-2 text-center font-bold theme-heading tabular-nums">
                      {toPersianDigits(entry.winRatePct)}٪
                    </span>
                    <span className="hidden sm:flex sm:col-span-2 items-center justify-center gap-1 font-bold theme-accent-gold tabular-nums">
                      <Award className="w-3.5 h-3.5 shrink-0" />
                      <span>{toPersianDigits(totalKots)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
