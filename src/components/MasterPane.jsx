/**
 * Reusable list pane used by master-data screens (Locations, Vehicles, …).
 * Renders a vertical list of items with optional inline adder, row actions,
 * selection, and meta text per row.
 */
export function Pane({
  title,
  items,
  selectedId,
  onSelect,
  adder,
  actions,
  empty,
  renderMeta,
}) {
  return (
    <div className="pane">
      <div className="pane-head">
        {title} <span className="muted small">({items.length})</span>
      </div>
      {adder}
      <ul className="pane-list">
        {items.length === 0 && (
          <li className="pane-empty">{empty || 'Empty'}</li>
        )}
        {items.map((it) => (
          <li
            key={it.id}
            className={[
              'pane-row',
              selectedId === it.id ? 'selected' : '',
              it.is_active === false ? 'inactive' : '',
            ].join(' ').trim()}
            onClick={() => onSelect && onSelect(it.id)}
          >
            <span className="pane-row-name">
              {it.name}
              {renderMeta && renderMeta(it) && (
                <span className="pane-row-meta">{renderMeta(it)}</span>
              )}
              {it.is_active === false && <span className="pill">inactive</span>}
            </span>
            {actions && (
              <span onClick={(e) => e.stopPropagation()}>{actions(it)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RowActions({ item, onRename, onToggle, onDelete }) {
  return (
    <span className="row-actions">
      <button title="Rename" onClick={onRename}>✎</button>
      <button
        title={item.is_active === false ? 'Activate' : 'Deactivate'}
        onClick={onToggle}
      >
        {item.is_active === false ? '◻' : '◼'}
      </button>
      <button title="Delete" onClick={onDelete} className="danger">×</button>
    </span>
  );
}
