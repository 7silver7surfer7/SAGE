import { useEffect, useState } from 'react';
import LoaderDots from '@/components/LoaderDots';

interface Analytics {
  live: { visitors: number };
  visitors: { d1: number; d7: number; d30: number };
  pageviews: { d1: number; d7: number; d30: number };
  sessions7: number;
  activeWallets: { dau: number; wau: number };
  newUsers7: number;
  conversion: { visitors30: number; signedIn30: number; pct: number };
  topPages: { path: string; views: number }[];
  topReferrers: { host: string | null; views: number }[];
  devices: { device: string; views: number }[];
  countries: { country: string | null; views: number }[];
  daily: { day: string; visitors: number; pageviews: number }[];
  social7: { posts: number; tips: number; collects: number };
}

/** Tiny dependency-free daily bar chart (pageviews bars + visitors line). */
function DailyChart({ daily }: { daily: Analytics['daily'] }) {
  if (!daily.length) return <p className='analytics__empty'>No traffic recorded yet.</p>;
  const W = 640;
  const H = 160;
  const maxPv = Math.max(...daily.map((d) => d.pageviews), 1);
  const bw = W / Math.max(daily.length, 1);
  const y = (v: number) => H - (v / maxPv) * (H - 14);
  const line = daily
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${(i + 0.5) * bw},${y(d.visitors)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='analytics__chart' preserveAspectRatio='none'>
      {daily.map((d, i) => (
        <rect
          key={d.day}
          x={i * bw + 1}
          y={y(d.pageviews)}
          width={Math.max(bw - 2, 1)}
          height={H - y(d.pageviews)}
          className='analytics__bar'
        >
          <title>{`${new Date(d.day).toISOString().slice(0, 10)} — ${d.pageviews} views, ${d.visitors} visitors`}</title>
        </rect>
      ))}
      <path d={line} fill='none' className='analytics__line' strokeWidth={2} />
    </svg>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className='analytics__kpi'>
      <span className='analytics__kpi-value'>{value}</span>
      <span className='analytics__kpi-label'>{label}</span>
      {sub && <span className='analytics__kpi-sub'>{sub}</span>}
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: { label: string; views: number }[] }) {
  const max = Math.max(...rows.map((r) => r.views), 1);
  return (
    <div className='analytics__list'>
      <h4>{title}</h4>
      {rows.length ? (
        rows.map((r) => (
          <div key={r.label} className='analytics__list-row'>
            <span className='analytics__list-label'>{r.label}</span>
            <span className='analytics__list-bar' style={{ width: `${(r.views / max) * 100}%` }} />
            <span className='analytics__list-count'>{r.views}</span>
          </div>
        ))
      ) : (
        <p className='analytics__empty'>none yet</p>
      )}
    </div>
  );
}

export function AnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/analytics/')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 60_000); // keep "live now" fresh
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <p className='analytics__empty'>Analytics failed: {error}</p>;
  if (!data) return <LoaderDots />;

  return (
    <div className='analytics'>
      <div className='analytics__kpis'>
        <Kpi label='live now' value={data.live.visitors} sub='last 5 min' />
        <Kpi label='visitors' value={data.visitors.d1} sub={`${data.visitors.d7} · 7d / ${data.visitors.d30} · 30d`} />
        <Kpi label='pageviews' value={data.pageviews.d1} sub={`${data.pageviews.d7} · 7d / ${data.pageviews.d30} · 30d`} />
        <Kpi label='sessions · 7d' value={data.sessions7} />
        <Kpi label='active wallets' value={data.activeWallets.dau} sub={`${data.activeWallets.wau} · 7d`} />
        <Kpi label='new users · 7d' value={data.newUsers7} />
        <Kpi
          label='wallet conversion'
          value={`${data.conversion.pct}%`}
          sub={`${data.conversion.signedIn30}/${data.conversion.visitors30} · 30d`}
        />
      </div>

      <h4 className='analytics__section'>Last 30 days — pageviews (bars) · unique visitors (line)</h4>
      <DailyChart daily={data.daily} />

      <div className='analytics__grid'>
        <TopList title='Top pages · 7d' rows={data.topPages.map((p) => ({ label: p.path, views: p.views }))} />
        <TopList title='Referrers · 7d' rows={data.topReferrers.map((r) => ({ label: r.host || '—', views: r.views }))} />
        <TopList title='Devices · 7d' rows={data.devices.map((d) => ({ label: d.device, views: d.views }))} />
        <TopList title='Countries · 7d' rows={data.countries.map((c) => ({ label: c.country || '—', views: c.views }))} />
      </div>

      <h4 className='analytics__section'>SAGE Social · 7d</h4>
      <div className='analytics__kpis'>
        <Kpi label='posts' value={data.social7.posts} />
        <Kpi label='tips' value={data.social7.tips} />
        <Kpi label='collects' value={data.social7.collects} />
      </div>
    </div>
  );
}
