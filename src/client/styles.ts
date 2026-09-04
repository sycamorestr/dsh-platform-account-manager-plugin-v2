export const styles = `
.sam_section,
.sam_section * { box-sizing: border-box; }

.sam_section {
  width: 100%;
  max-width: 980px;
  color: var(--dsw-alias-label-primary);
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 13px;
}

.sam_pageHeader,
.sam_directoryHeader,
.sam_accountRow,
.sam_toolbar,
.sam_modalHeader,
.sam_formActions,
.sam_actions,
.sam_nameLine,
.sam_notice,
.sam_error,
.sam_toggleRow,
.sam_checkRow,
.sam_readonlyDirectory,
.sam_archived summary,
.sam_archived li {
  display: flex;
  align-items: center;
}

.sam_pageHeader { min-height: 50px; justify-content: space-between; gap: 16px; }
.sam_pageHeader h2,
.sam_pageHeader p,
.sam_directoryHeader h3,
.sam_empty h3,
.sam_empty p,
.sam_modalHeader h3 { margin: 0; }
.sam_pageHeader h2 { font-size: 18px; line-height: 26px; font-weight: 650; }
.sam_pageHeader p { margin-top: 3px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }

.sam_primaryButton,
.sam_secondaryButton,
.sam_iconButton {
  border: 1px solid transparent;
  border-radius: 7px;
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: none;
}

.sam_primaryButton,
.sam_secondaryButton { min-height: 34px; padding: 6px 12px; font-size: 13px; line-height: 20px; font-weight: 600; }
.sam_primaryButton { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); }
.sam_primaryButton:hover { background: var(--dsw-alias-button-primary-hover); }
.sam_secondaryButton { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.sam_secondaryButton:hover,
.sam_iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sam_iconButton { width: 32px; height: 32px; padding: 0; background: transparent; color: var(--dsw-alias-label-secondary); }
.sam_iconButton:hover,
.sam_iconButton[data-active="true"] { color: var(--dsw-alias-label-primary); }
.sam_iconButton[data-active="true"] { background: var(--dsw-alias-bg-layer-2); }
.sam_iconButton[data-danger="true"]:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
.sam_primaryButton:disabled,
.sam_secondaryButton:disabled,
.sam_iconButton:disabled { opacity: .5; cursor: not-allowed; }

.sam_primaryButton:focus-visible,
.sam_secondaryButton:focus-visible,
.sam_iconButton:focus-visible,
.sam_field input:focus-visible,
.sam_field select:focus-visible,
.sam_field textarea:focus-visible,
.sam_toggleRow input:focus-visible,
.sam_checkRow input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }

.sam_notice,
.sam_error { align-items: flex-start; gap: 9px; border-radius: 7px; padding: 10px 12px; font-size: 12px; line-height: 18px; }
.sam_notice { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.sam_error { background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.sam_notice svg,
.sam_error svg { margin-top: 1px; flex: none; }
.sam_toolbar { justify-content: space-between; min-height: 32px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.sam_toolbarActions { min-width: 0; display: flex; align-items: center; gap: 6px; }
.sam_searchBox { width: min(360px, 48vw); height: 34px; display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
.sam_searchBox:focus-within { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.sam_searchBox input { min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.sam_searchBox input::placeholder { color: var(--dsw-alias-label-tertiary); }

.sam_directoryList { display: flex; flex-direction: column; gap: 12px; }
.sam_directoryGroup { overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-3); }
.sam_directoryHeader {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 13px 14px 11px;
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.sam_directoryIcon { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.sam_directoryIdentity,
.sam_accountIdentity { min-width: 0; }
.sam_accountId { flex: none; padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; line-height: 17px; }
.sam_nameLine { min-width: 0; gap: 7px; flex-wrap: wrap; }
.sam_directoryHeader h3,
.sam_accountIdentity strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 20px; font-weight: 650; }
.sam_browserTag,
.sam_platformTag,
.sam_onlineTag { min-height: 19px; padding: 1px 6px; border-radius: 5px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 16px; white-space: nowrap; }
.sam_onlineTag::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.sam_onlineTag[data-online="true"] { color: var(--dsw-alias-state-success-primary); }
.sam_onlineTag[data-online="true"]::before { background: var(--dsw-alias-state-success-primary); }
.sam_directoryMeta,
.sam_metaLine { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 3px 12px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }
.sam_directoryMeta span[data-state="ok"] { color: var(--dsw-alias-state-success-primary); }
.sam_directoryMeta span[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.sam_directoryActions { align-self: start; }
.sam_actions { gap: 1px; }
.sam_path { grid-column: 2 / -1; min-width: 0; margin-top: 1px; color: var(--dsw-alias-label-tertiary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; line-height: 16px; overflow-wrap: anywhere; }

.sam_accountList,
.sam_archived ul { margin: 0; padding: 0; list-style: none; }
.sam_profileGroups { display: flex; flex-direction: column; }
.sam_profileGroup + .sam_profileGroup { border-top: 1px solid var(--dsw-alias-border-l2); }
.sam_profileHeader { min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 7px 14px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sam_profileHeader strong { color: var(--dsw-alias-label-primary); font-size: 12px; }
.sam_profileHeader span { color: var(--dsw-alias-label-tertiary); }
.sam_profileHeader span:last-child { margin-left: auto; }
.sam_accountRow { min-height: 64px; display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; gap: 12px; padding: 10px 12px 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.sam_accountRow:last-child { border-bottom: 0; }
.sam_accountRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sam_platformTag { background: var(--dsw-alias-bg-layer-2); }
.sam_metaLine span + span::before,
.sam_directoryMeta span + span::before { content: "·"; margin-right: 12px; color: var(--dsw-alias-label-tertiary); }
.sam_accountStatus { display: flex; align-items: center; gap: 7px; }
.sam_statusPill { display: inline-flex; align-items: center; gap: 6px; min-width: 82px; color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; }
.sam_statusPill > span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.sam_statusPill[data-state="success"] { color: var(--dsw-alias-state-success-primary); }
.sam_statusPill[data-state="danger"] { color: var(--dsw-alias-state-error-primary); }
.sam_statusPill[data-state="warning"] { color: var(--dsw-alias-state-warn-label); }
.sam_keepAliveMark { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 5px; color: var(--dsw-alias-label-tertiary); }
.sam_keepAliveMark[data-active="true"] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-success-primary); }
.sam_directoryEmpty { padding: 16px; color: var(--dsw-alias-label-tertiary); text-align: center; font-size: 12px; }
.sam_searchEmpty { min-height: 80px; display: grid; place-items: center; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; }

.sam_empty { min-height: 210px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; padding: 24px; color: var(--dsw-alias-label-tertiary); text-align: center; }
.sam_empty h3 { margin-top: 10px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 21px; }
.sam_empty p { margin-top: 4px; margin-bottom: 14px; font-size: 12px; }

.sam_archived { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.sam_archived summary { width: max-content; max-width: 100%; gap: 7px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sam_archived summary span { color: var(--dsw-alias-label-tertiary); }
.sam_archived ul { margin-top: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; }
.sam_archived li { min-height: 50px; justify-content: space-between; gap: 12px; padding: 8px 10px 8px 13px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.sam_archived li:last-child { border-bottom: 0; }
.sam_archived li > div:first-child { min-width: 0; display: flex; flex-direction: column; }
.sam_archived li strong { font-size: 12px; line-height: 18px; }
.sam_archived li span { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }
.sam_archived li .sam_archivedPath { max-width: 640px; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.sam_archivedDirectoryItem { min-height: 64px !important; }

.sam_overlay { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--dsw-alias-bg-mask-2); }
.sam_modal { width: min(660px, 100%); max-height: min(820px, calc(100vh - 40px)); overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); box-shadow: var(--dsw-shadow-lv2); }
.sam_modalHeader { position: sticky; top: 0; z-index: 1; min-height: 56px; justify-content: space-between; gap: 16px; padding: 11px 13px 11px 18px; border-bottom: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); }
.sam_modalHeader h3 { font-size: 16px; line-height: 24px; font-weight: 650; }
.sam_form { display: flex; flex-direction: column; gap: 16px; padding: 18px; }
.sam_fieldGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.sam_field { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sam_field[data-wide="true"] { grid-column: 1 / -1; }
.sam_fieldGrid > [data-wide="true"] { grid-column: 1 / -1; }
.sam_fieldAction { justify-content: flex-end; }
.sam_field label,
.sam_fieldset legend { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 550; }
.sam_field input,
.sam_field select,
.sam_field textarea { width: 100%; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.sam_field input,
.sam_field select { height: 36px; padding: 0 10px; }
.sam_field textarea { min-height: 74px; padding: 8px 10px; resize: vertical; }
.sam_field input::placeholder,
.sam_field textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
.sam_fieldset { min-width: 0; margin: 0; padding: 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.sam_fieldset legend { padding: 0 5px; }
.sam_segmented { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; margin-bottom: 13px; padding: 2px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); }
.sam_segmented label { min-height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 5px; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; }
.sam_segmented label[data-selected="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv1); }
.sam_segmented label[data-disabled="true"] { opacity: .45; cursor: not-allowed; }
.sam_segmented input { position: absolute; opacity: 0; pointer-events: none; }
.sam_inputAction { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }

.sam_readonlyDirectory { align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.sam_readonlyDirectory svg { margin-top: 2px; flex: none; }
.sam_readonlyDirectory div { min-width: 0; display: flex; flex-direction: column; }
.sam_readonlyDirectory strong { font-size: 12px; line-height: 18px; }
.sam_readonlyDirectory span { overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; line-height: 16px; }
.sam_toggleRow,
.sam_checkRow { justify-content: space-between; gap: 12px; min-height: 38px; }
.sam_toggleRow strong { font-size: 13px; }
.sam_toggleRow input {
  appearance: none;
  position: relative;
  width: 34px;
  height: 20px;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
}
.sam_toggleRow input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  transition: transform .16s ease, background .16s ease;
}
.sam_toggleRow input:checked { background: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }
.sam_toggleRow input:checked::after { transform: translateX(14px); background: var(--dsw-alias-label-primary-inverted); }
.sam_checkRow { justify-content: flex-start; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sam_checkRow input { width: 16px; height: 16px; accent-color: var(--dsw-alias-state-business-primary); }
.sam_runMeta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 10px 12px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); }
.sam_runMeta span { display: flex; flex-direction: column; gap: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.sam_runMeta strong { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sam_formActions { justify-content: flex-end; gap: 8px; }
.sam_formActionsSplit { justify-content: flex-start; }
.sam_actionSpacer { flex: 1; }
.sam_result { display: flex; align-items: center; gap: 11px; padding: 13px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.sam_result[data-state="success"] { color: var(--dsw-alias-state-success-primary); }
.sam_result[data-state="danger"] { color: var(--dsw-alias-state-error-primary); }
.sam_result[data-state="warning"] { color: var(--dsw-alias-state-warn-label); }
.sam_result > svg { flex: none; }
.sam_result > div { min-width: 0; display: flex; flex-direction: column; }
.sam_result strong { font-size: 14px; line-height: 21px; }
.sam_result span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.sam_resultDetails { display: flex; flex-direction: column; gap: 5px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }
.sam_resultDetails p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 19px; }
.sam_resultDetails span { overflow-wrap: anywhere; }
.sam_deleteModes { display: grid; gap: 8px; }
.sam_deleteModes label { min-width: 0; display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 9px; padding: 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; cursor: pointer; }
.sam_deleteModes label[data-selected="true"] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-bg-layer-2); }
.sam_deleteModes label[data-disabled="true"] { opacity: .55; cursor: not-allowed; }
.sam_deleteModes input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--dsw-alias-state-business-primary); }
.sam_deleteModes span { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sam_deleteModes strong { font-size: 12px; line-height: 18px; }
.sam_deleteModes small { overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 16px; }

.sam_spinner { animation: sam-spin .8s linear infinite; }
@keyframes sam-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sam_spinner { animation: none; } }

@media (max-width: 760px) {
  .sam_directoryHeader { grid-template-columns: 36px minmax(0, 1fr); }
  .sam_directoryActions { grid-column: 2; }
  .sam_path { grid-column: 1 / -1; }
  .sam_accountRow { grid-template-columns: minmax(0, 1fr) auto; }
  .sam_accountStatus { justify-content: flex-end; }
  .sam_accountRow > .sam_actions { grid-column: 1 / -1; justify-content: flex-end; }
}

@media (max-width: 520px) {
  [data-sam-settings-overlay="true"] { z-index: 2147483000 !important; }
  .sam_section { position: absolute; z-index: 2; inset: 64px 0 0; width: auto; max-width: none; padding: 14px; overflow-y: auto; background: var(--dsw-alias-bg-base); }
  .sam_pageHeader { align-items: flex-start; flex-direction: column; }
  .sam_pageHeader .sam_primaryButton { width: 100%; }
  .sam_toolbar { align-items: stretch; flex-direction: column; gap: 8px; }
  .sam_toolbarActions { width: 100%; }
  .sam_searchBox { width: 100%; }
  .sam_directoryHeader { grid-template-columns: minmax(0, 1fr); }
  .sam_directoryIcon { display: none; }
  .sam_directoryActions { grid-column: 1; justify-content: flex-end; }
  .sam_path { grid-column: 1; }
  .sam_accountRow { grid-template-columns: minmax(0, 1fr); }
  .sam_accountStatus { justify-content: flex-start; }
  .sam_accountRow > .sam_actions { grid-column: 1; justify-content: flex-end; }
  .sam_fieldGrid,
  .sam_runMeta { grid-template-columns: minmax(0, 1fr); }
  .sam_field[data-wide="true"] { grid-column: auto; }
  .sam_fieldGrid > [data-wide="true"] { grid-column: auto; }
  .sam_inputAction { grid-template-columns: minmax(0, 1fr); }
  .sam_inputAction .sam_secondaryButton { width: 100%; }
  .sam_overlay { padding: 0; align-items: stretch; }
  .sam_modal { width: 100%; max-height: 100vh; border: 0; border-radius: 0; }
  .sam_formActionsSplit { flex-wrap: wrap; }
  .sam_formActionsSplit .sam_actionSpacer { display: none; }
  .sam_archived li { align-items: flex-start; flex-direction: column; }
  .sam_archived li > .sam_actions { align-self: flex-end; }
}
`
