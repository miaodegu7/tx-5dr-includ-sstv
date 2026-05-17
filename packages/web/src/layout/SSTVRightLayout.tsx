import React from 'react';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { QSONotificationToggleButton } from '../components/common/QSONotificationToggleButton';
import { ServerHealthButton } from '../components/system/ServerHealthButton';
import { SettingsButton } from '../components/common/SettingsButton';
import { RadioControl } from '../components/radio/control/RadioControl';
import { SSTVTxPanel } from '../components/sstv/SSTVTxPanel';

export const SSTVRightLayout: React.FC = () => {
  const handleOpenRadioSettings = () => {
    window.dispatchEvent(new Event('openProfileModal'));
  };

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <div
        className="flex-shrink-0 flex justify-between items-center p-1 px-2 md:p-2 md:px-3"
        style={{
          WebkitAppRegion: 'drag',
        } as React.CSSProperties & { WebkitAppRegion: string }}
      >
        <div />
        <div className="flex items-center gap-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties & { WebkitAppRegion: string }}>
          <ServerHealthButton />
          <QSONotificationToggleButton />
          <ThemeToggle variant="dropdown" size="sm" />
          <SettingsButton />
        </div>
      </div>

      <div className="flex-1 p-2 pt-0 md:p-5 md:pt-0 flex flex-col gap-2 md:gap-4 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <SSTVTxPanel />
        </div>
        <div className="flex-shrink-0">
          <RadioControl onOpenRadioSettings={handleOpenRadioSettings} />
        </div>
      </div>
    </div>
  );
};
