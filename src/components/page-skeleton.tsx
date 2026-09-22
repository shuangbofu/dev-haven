export function PageSkeleton() {
  return <section className="page-skeleton" aria-busy="true" aria-label="正在加载页面" role="status">
    <span className="sr-only">正在加载页面</span>
    <div className="page-skeleton-heading"><i /><i /></div>
    <div className="page-skeleton-tabs"><i /><i /><i /></div>
    <div className="page-skeleton-body">{Array.from({ length: 6 }, (_, index) => <div key={index}><i /><i /><i /></div>)}</div>
  </section>;
}
