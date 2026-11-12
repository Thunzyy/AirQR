/**
 * BottomNav - Bottom navigation bar component
 */

import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import Icon from '../ui/Icon';

interface BottomNavProps {
  activeTab: number;
  onTabChange: (tab: number) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
}) => {
  const { t } = useTranslation();

  const tabs = [
    { icon: 'qr_code_2', labelKey: 'nav.encoder', path: '/' },
    { icon: 'qr_code_scanner', labelKey: 'nav.decoder', path: '/decoder' },
    { icon: 'center_focus_weak', imageSrc: '/android-chrome-192x192.png', labelKey: 'nav.scanner', path: '/scanner' },
    { icon: 'history', labelKey: 'nav.history', path: '/history' },
    { icon: 'settings', labelKey: 'nav.settings', path: '/settings' },
  ];

  const [, setLocation] = useLocation();

  const handleTabClick = (index: number, path: string) => {
    onTabChange(index);
    setLocation(path);
  };

  const tabWidthPercent = 100 / tabs.length;
  const activeIndicatorExtraPx = 18;
  const activeIndicatorInsetPx = activeIndicatorExtraPx / 2;

  return (
    <nav
      aria-label={t('nav.mainNavigation')}
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(0.8rem+env(safe-area-inset-bottom,0px))] pt-3 pointer-events-none"
    >
      <div className="pointer-events-auto flex h-[76px] w-full max-w-[560px] items-center rounded-[34px] bg-[var(--airqr-nav-surface)] px-2 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-2xl dark:shadow-[0_20px_70px_rgba(0,0,0,0.42)]">
        <div className="relative grid h-[60px] w-full grid-cols-5">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 z-0 px-0.5 transition-[left,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{
              left: `calc(${activeTab * tabWidthPercent}% - ${activeIndicatorInsetPx}px)`,
              width: `calc(${tabWidthPercent}% + ${activeIndicatorExtraPx}px)`,
            }}
          >
            <div className="h-full rounded-[30px] bg-[var(--airqr-nav-active)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_28px_rgba(0,0,0,0.14)] backdrop-blur-xl dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_28px_rgba(0,0,0,0.24)]" />
          </div>
        {tabs.map((tab, index) => (
          <button
            key={tab.labelKey}
            onClick={() => handleTabClick(index, tab.path)}
            aria-label={t(tab.labelKey)}
            aria-current={activeTab === index ? 'page' : undefined}
            className={`relative z-10 flex h-[60px] min-w-0 items-center justify-center rounded-[30px] transition-colors duration-200 ${
              activeTab === index
                ? 'text-[var(--airqr-text-primary)]'
                : 'text-[var(--airqr-text-muted)] hover:text-[var(--airqr-text-secondary)]'
            }`}
          >
            <div className="flex min-w-0 flex-col items-center justify-center px-1">
              <div className="flex h-8 items-center justify-center">
                {tab.imageSrc ? (
                  <img
                    src={tab.imageSrc}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className={`${activeTab === index ? 'size-[34px]' : 'size-[31px]'} object-contain`}
                  />
                ) : (
                  <Icon name={tab.icon} className={`${activeTab === index ? 'text-[28px]' : 'text-[25px]'} leading-none`} />
                )}
              </div>
              <span className={`mt-0.5 max-w-full truncate leading-none ${activeTab === index ? 'text-[12px] font-bold' : 'text-[12px] font-semibold'}`}>
                {t(tab.labelKey)}
              </span>
            </div>
          </button>
        ))}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
