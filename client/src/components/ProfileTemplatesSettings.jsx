import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { avatarPresetAPI, bannerTemplateAPI } from "../services/api";
import { PROFILE_TABS, searchForTab, tabForKey, tabFromSearch } from "../utils/builtInTemplates";
import ProfileTemplateModal from "./ProfileTemplateModal";
import ProfileTemplatesTab from "./ProfileTemplatesTab";
import { useToast } from "./feedback/context";
import "../styles/profile-templates.css";

// Superadmin "Banner templates & avatars": the preset profile banners and avatars that
// jobseekers (and, for banners, employers) can pick. Two tabs, kept in the URL
// (?tab=avatars), each with its own list. Both lists load here so the tabs can show
// their counts; a template is an uploaded SVG or PNG (rasterized by the server), and
// there is no banner builder.

const SOURCES = {
  banners: { kind: "banner", api: bannerTemplateAPI, field: "templates" },
  avatars: { kind: "avatar", api: avatarPresetAPI, field: "presets" },
};

const emptyList = { items: [], status: "loading" };

export default function ProfileTemplatesSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = tabFromSearch(params.toString());
  const [lists, setLists] = useState({ banners: emptyList, avatars: emptyList });
  const [modal, setModal] = useState(null); // { tab, template } (template null = create)
  const tabRefs = useRef({});

  const load = useCallback((which) => {
    const source = SOURCES[which];
    return source.api
      .adminList()
      .then((res) => {
        const items = Array.isArray(res.data?.[source.field]) ? res.data[source.field] : [];
        setLists((prev) => ({ ...prev, [which]: { items, status: "ready" } }));
      })
      .catch(() => setLists((prev) => ({ ...prev, [which]: { items: prev[which].items, status: "error" } })));
  }, []);

  useEffect(() => {
    load("banners");
    load("avatars");
  }, [load]);

  const selectTab = (next) => setParams(searchForTab(params.toString(), next), { replace: true });

  const onTabKeyDown = (event) => {
    const next = tabForKey(tab, event.key);
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  const setItems = (which) => (items) => setLists((prev) => ({ ...prev, [which]: { ...prev[which], items } }));

  const onSaved = (_saved, outcome) => {
    const which = modal.tab;
    setModal(null);
    toast.success(t(`bannerTemplates.${outcome}`));
    load(which);
  };

  const uploadKey = `profileTemplates.${tab}.upload`;

  return (
    <section className="sac__card bt" aria-labelledby="profile-templates-title">
      <header className="bt__head">
        <div className="bt__head-text">
          <h2 id="profile-templates-title" className="bt__sr">
            {t("profileTemplates.title")}
          </h2>
          <p className="bt__subtitle">{t("profileTemplates.description")}</p>
        </div>
        <button type="button" className="bt__btn bt__btn--primary bt__upload" onClick={() => setModal({ tab, template: null })}>
          {t(uploadKey)}
        </button>
      </header>

      <div className="bt__tabs" role="tablist" aria-label={t("profileTemplates.tablist")} onKeyDown={onTabKeyDown}>
        {PROFILE_TABS.map((value) => {
          const selected = tab === value;
          const count = lists[value].status === "ready" ? lists[value].items.length : null;
          return (
            <button
              key={value}
              ref={(node) => {
                tabRefs.current[value] = node;
              }}
              type="button"
              role="tab"
              id={`pt-tab-${value}`}
              className="bt__tab-btn"
              aria-selected={selected}
              aria-controls={`pt-panel-${value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(value)}
            >
              {t(`profileTemplates.tabs.${value}`)}
              {count !== null ? <span className="bt__tab-count">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`pt-panel-${tab}`} aria-labelledby={`pt-tab-${tab}`} tabIndex={0} className="bt__panel">
        <ProfileTemplatesTab
          key={tab}
          kind={SOURCES[tab].kind}
          items={lists[tab].items}
          status={lists[tab].status}
          onChange={setItems(tab)}
          onReload={() => load(tab)}
          onUpload={() => setModal({ tab, template: null })}
          onEdit={(template) => setModal({ tab, template })}
        />
      </div>

      {modal ? (
        <ProfileTemplateModal
          key={`${modal.tab}-${modal.template?.id || "new"}`}
          kind={SOURCES[modal.tab].kind}
          template={modal.template}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      ) : null}
    </section>
  );
}
