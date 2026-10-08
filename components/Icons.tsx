export type IconName = 'bike'|'arrow'|'back'|'close'|'sun'|'moon'|'pause'|'play'|'map'|'download'|'share'|'search'|'chevron'|'info'|'rain'|'fog'|'list';
const paths: Record<IconName,React.ReactNode> = {
 bike: <><circle cx="5" cy="15" r="3.5"/><circle cx="19" cy="15" r="3.5"/><path d="m5 15 5-9 5 9H5l3-6h9M8 6h4m3-3h3l1 12"/></>,
 arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, back:<path d="M20 12H4m6-6-6 6 6 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,
 sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
 moon:<path d="M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10Z"/>, pause:<path d="M9 5v14M15 5v14"/>, play:<path d="m8 5 11 7-11 7Z"/>,
 map:<><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/></>,
 download:<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>, share:<><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 11 10-5M7 13l10 5"/></>,
 search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>, chevron:<path d="m8 4 8 8-8 8"/>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,rain:<><path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 2 9H5m2 3-1 3m7-3-1 3m7-3-1 3"/></>,fog:<path d="M3 8h18M5 12h14M3 16h18"/>,list:<path d="M4 6h16M4 12h16M4 18h16"/>,
};
export default function Icon({name,...props}:{name:IconName}&React.SVGProps<SVGSVGElement>) {
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
