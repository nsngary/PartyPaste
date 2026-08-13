import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function AboutPage() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("—");

  useEffect(() => {
    let active = true;
    void getVersion()
      .then((currentVersion) => {
        if (active) setVersion(currentVersion);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="pp-settings__section" aria-labelledby="settings-about">
      <h2 id="settings-about">{t("settings.about")}</h2>
      <dl className="pp-about-list">
        <div>
          <dt>{t("settings.application")}</dt>
          <dd>PartyPaste</dd>
        </div>
        <div>
          <dt>{t("settings.version")}</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>{t("settings.privacy")}</dt>
          <dd>{t("settings.localOnly")}</dd>
        </div>
      </dl>
    </section>
  );
}
