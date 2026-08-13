import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";

export function UpdateSettings() {
  const { t } = useTranslation();
  return (
    <section
      className="pp-settings__section"
      aria-labelledby="settings-updates"
    >
      <h2 id="settings-updates">{t("settings.updates")}</h2>
      <p>{t("settings.updateTaskBoundary")}</p>
      <p>{t("settings.manualUpdateInstructions")}</p>
      <Button disabled>{t("settings.checkForUpdates")}</Button>
    </section>
  );
}
