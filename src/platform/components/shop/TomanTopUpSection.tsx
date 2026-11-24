import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  TomanOrderSummary,
  fetchTomanPackagesRequest,
  initiateTomanOrderRequest,
  verifyTomanOrderRequest,
} from '../../items/inventoryClient';
import { ServerInventoryState } from '../../items/itemTypes';
import {
  TOMAN_TOPUP_PACKAGES,
  TomanPackageDefinition,
} from '../../items/tomanPackages';
import { toPersianDigits } from '../../theme/tokens';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';

interface TomanTopUpSectionProps {
  isAuthenticated?: boolean;
  onRequireAuth?: () => void;
  onInventorySync?: (inventory: ServerInventoryState) => void;
  pendingOrderIdFromUrl?: string | null;
  onClearPendingOrderId?: () => void;
  compactHeader?: boolean;
}

export const TomanTopUpSection: React.FC<TomanTopUpSectionProps> = ({
  isAuthenticated = false,
  onRequireAuth,
  onInventorySync,
  pendingOrderIdFromUrl = null,
  onClearPendingOrderId,
  compactHeader = false,
}) => {
  const [packages, setPackages] = useState<readonly TomanPackageDefinition[]>(
    TOMAN_TOPUP_PACKAGES
  );
  const [gatewayMode, setGatewayMode] = useState<'zarinpal' | 'sandbox'>('sandbox');
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null);
  const [sandboxOrder, setSandboxOrder] = useState<{
    order: TomanOrderSummary;
    pkg: TomanPackageDefinition;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
    refId?: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetchTomanPackagesRequest()
      .then((res) => {
        if (!active || !res.ok) return;
        if (Array.isArray(res.packages) && res.packages.length > 0) {
          setPackages(res.packages);
        }
        if (res.gatewayMode) {
          setGatewayMode(res.gatewayMode);
        }
      })
      .catch(() => {
        // Fallback TOMAN_TOPUP_PACKAGES already hydrated
      });
    return () => {
      active = false;
    };
  }, []);

  // Auto-verify returning payment callback (?tomanOrder=...)
  useEffect(() => {
    if (!pendingOrderIdFromUrl || !isAuthenticated) return;
    let active = true;
    setVerifying(true);
    verifyTomanOrderRequest({ orderId: pendingOrderIdFromUrl })
      .then((res) => {
        if (!active) return;
        onClearPendingOrderId?.();
        if (res.ok && res.inventory) {
          onInventorySync?.(res.inventory);
          setStatusMessage({
            type: 'success',
            text: 'پرداخت با موفقیت تأیید شد و موجودی حساب شما شارژ گردید.',
            refId: res.order?.refId ?? null,
          });
        } else {
          setStatusMessage({
            type: 'error',
            text: res.message ?? 'تأیید تراکنش پرداخت انجام نشد.',
          });
        }
      })
      .catch(() => {
        if (active) {
          onClearPendingOrderId?.();
          setStatusMessage({
            type: 'error',
            text: 'خطا در بررسی وضعیت پرداخت با سرور.',
          });
        }
      })
      .finally(() => {
        if (active) setVerifying(false);
      });
    return () => {
      active = false;
    };
  }, [pendingOrderIdFromUrl, isAuthenticated, onClearPendingOrderId, onInventorySync]);

  const handleStartPurchase = async (pkg: TomanPackageDefinition) => {
    setStatusMessage(null);
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }

    setBusyPackageId(pkg.id);
    try {
      const callbackUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;
      const res = await initiateTomanOrderRequest(pkg.id, callbackUrl);
      if (!res.ok || !res.order) {
        setStatusMessage({
          type: 'error',
          text: res.message ?? 'امکان ثبت سفارش پرداخت وجود ندارد.',
        });
        return;
      }

      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
        return;
      }

      setSandboxOrder({
        order: res.order,
        pkg: res.package ?? pkg,
      });
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'خطا در برقراری ارتباط با سرویس پرداخت.',
      });
    } finally {
      setBusyPackageId(null);
    }
  };

  const handleConfirmSandboxPayment = async () => {
    if (!sandboxOrder || verifying) return;
    setVerifying(true);
    try {
      const res = await verifyTomanOrderRequest({
        orderId: sandboxOrder.order.orderId,
      });
      if (!res.ok) {
        setStatusMessage({
          type: 'error',
          text: res.message ?? 'تأیید سفارش ناموفق بود.',
        });
        setSandboxOrder(null);
        return;
      }
      if (res.inventory) {
        onInventorySync?.(res.inventory);
      }
      setSandboxOrder(null);
      setStatusMessage({
        type: 'success',
        text: `شارژ «${sandboxOrder.pkg.title}» با موفقیت انجام شد و به کیف پول اضافه گردید.`,
        refId: res.order?.refId ?? null,
      });
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'خطا در تأیید سفارش آزمایشی.',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <section
      data-testid="shop-toman-topup-section"
      data-shop-section="toman_topup"
      aria-label="خرید سکه و الماس (تومانی)"
      className="space-y-3"
    >
      {!compactHeader && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold theme-heading truncate flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#22C55E] shrink-0" />
              <span>خرید سکه و الماس (تومانی)</span>
            </h2>
            <p className="text-[11px] sm:text-xs theme-muted truncate mt-0.5">
              شارژ مستقیم سکه و الماس با پرداخت امن بانکی به تومان
            </p>
          </div>
          <span className="text-[11px] font-extrabold theme-accent-teal shrink-0 inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{gatewayMode === 'zarinpal' ? 'درگاه شاپرک' : 'درگاه آزمایشی'}</span>
          </span>
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          data-testid="toman-payment-status"
          className={`eyvan-card rounded-2xl px-4 py-3 border text-xs font-extrabold flex items-center justify-between gap-2 ${
            statusMessage.type === 'success'
              ? 'border-[#22C55E]/50 bg-[#22C55E]/10 theme-win'
              : 'border-red-500/45 bg-red-500/10 text-red-400'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>
              {statusMessage.text}
              {statusMessage.refId ? ` (کد پیگیری: ${statusMessage.refId})` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            aria-label="بستن پیام"
            className="w-6 h-6 rounded-lg flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {packages.map((pkg) => {
          const isBusy = busyPackageId === pkg.id;
          return (
            <div
              key={pkg.id}
              data-testid={`toman-package-${pkg.id}`}
              className="eyvan-card eyvan-card-hover rounded-2xl p-4 flex flex-col justify-between gap-3.5 border border-[var(--eyvan-line)]"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold text-[#22C55E]">
                    شارژ تومانی
                  </span>
                  {pkg.badge && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#0B1528]/88 text-[#F3D179] border border-[#D4AE58]/45">
                      {pkg.badge}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl theme-subcard border border-[var(--eyvan-gold-border)] flex items-center justify-center shrink-0">
                    {pkg.currencyKind === 'gems' ? (
                      <PurpleGemSvg size={26} />
                    ) : pkg.currencyKind === 'bundle' ? (
                      <div className="flex items-center -space-x-2">
                        <GoldCoinSvg size={20} />
                        <PurpleGemSvg size={20} />
                      </div>
                    ) : (
                      <GoldCoinSvg size={26} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-black theme-heading truncate">
                      {pkg.title}
                    </h3>
                    <p className="text-[11px] theme-muted mt-0.5 line-clamp-1">
                      {pkg.subtitle}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-extrabold theme-heading tabular-nums pt-0.5">
                  {pkg.coinsAmount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <GoldCoinSvg size={14} />
                      <span>{toPersianDigits(pkg.coinsAmount.toLocaleString())} سکه</span>
                    </span>
                  )}
                  {pkg.coinsAmount > 0 && pkg.gemsAmount > 0 && (
                    <span className="theme-muted">+</span>
                  )}
                  {pkg.gemsAmount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <PurpleGemSvg size={14} />
                      <span>{toPersianDigits(pkg.gemsAmount.toLocaleString())} الماس</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-2.5 border-t border-[var(--eyvan-line)] flex items-center justify-between gap-2">
                <div className="text-sm font-black theme-heading tabular-nums">
                  {toPersianDigits(pkg.priceToman.toLocaleString())}{' '}
                  <span className="text-[11px] font-bold theme-muted">تومان</span>
                </div>

                <button
                  type="button"
                  disabled={isBusy || verifying}
                  data-testid={`toman-buy-btn-${pkg.id}`}
                  onClick={() => void handleStartPurchase(pkg)}
                  className="min-h-[38px] px-3.5 rounded-xl bg-gradient-to-b from-[#22C55E] to-[#15803D] hover:brightness-105 disabled:opacity-55 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer transition-all shrink-0"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : !isAuthenticated ? (
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <CreditCard className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{isAuthenticated ? 'پرداخت تومانی' : 'ورود و خرید'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Sandbox Confirmation Modal (when Zarinpal Merchant ID is not configured) */}
      {sandboxOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأیید پرداخت آزمایشی تومانی"
          data-testid="toman-sandbox-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/68 backdrop-blur-sm"
          onClick={() => !verifying && setSandboxOrder(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.58)] p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#22C55E] shrink-0" />
                <h3 className="text-sm sm:text-base font-black theme-heading">
                  تأیید پرداخت (درگاه آزمایشی)
                </h3>
              </div>
              <button
                type="button"
                disabled={verifying}
                onClick={() => setSandboxOrder(null)}
                aria-label="بستن"
                className="w-8 h-8 rounded-full theme-btn-secondary border flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl theme-subcard border p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="theme-muted font-bold">بسته انتخابی</span>
                <span className="theme-heading font-black">{sandboxOrder.pkg.title}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="theme-muted font-bold">کد سفارش</span>
                <code dir="ltr" className="font-mono text-[11px] theme-heading">
                  {sandboxOrder.order.orderId}
                </code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="theme-muted font-bold">مبلغ قابل پرداخت</span>
                <span className="font-black text-[#22C55E] tabular-nums">
                  {toPersianDigits(sandboxOrder.order.amountToman.toLocaleString())} تومان
                </span>
              </div>
            </div>

            <p className="text-[11px] theme-muted leading-relaxed">
              در حالت آزمایشی بدون درگاه بانکی واقعی، با زدن دکمه زیر تراکنش تأیید و موجودی حساب بلافاصله شارژ می‌شود.
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={verifying}
                data-testid="toman-sandbox-confirm-btn"
                onClick={() => void handleConfirmSandboxPayment()}
                className="flex-1 min-h-[42px] px-4 rounded-xl bg-gradient-to-b from-[#22C55E] to-[#15803D] hover:brightness-105 disabled:opacity-60 text-white text-xs sm:text-sm font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>تأیید و شارژ حساب</span>
              </button>
              <button
                type="button"
                disabled={verifying}
                onClick={() => setSandboxOrder(null)}
                className="min-h-[42px] px-4 rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
