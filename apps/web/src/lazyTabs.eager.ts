import EncoderTab from "./components/tabs/EncoderTab";
import DecoderTab from "./components/tabs/DecoderTab";
import ScannerTab from "./components/tabs/ScannerTab";
import HistoryTab from "./components/tabs/HistoryTab";
import SettingsTab from "./components/tabs/SettingsTab";

export { EncoderTab, DecoderTab, ScannerTab, HistoryTab, SettingsTab };

export const preloadScannerTab = async () => {
  await import("./components/tabs/ScannerTab");
};
