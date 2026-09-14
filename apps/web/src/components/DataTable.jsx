/**
 * At the base (320px) breakpoint this becomes a stacked card list — no
 * column is dropped, everything just re-lays out. At md+ it is a real table.
 * `renderActions`, when given, is rendered in both layouts and is always
 * visible (never hover-only).
 */
export function DataTable({ columns, rows, getRowKey, renderActions }) {
  return (
    <div>
      <div className="hidden overflow-x-auto rounded-[16px] border border-edge bg-paper shadow-xs md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-edge">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-12 py-8 text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint"
                >
                  {col.header}
                </th>
              ))}
              {renderActions ? <th className="px-12 py-8" aria-hidden="true" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={getRowKey(row)}
                className={`transition-colors duration-150 hover:bg-surface ${index % 2 === 1 ? 'bg-zebra' : ''}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-12 py-12 align-middle text-[16px] leading-[24px] text-body ${
                      col.mono ? 'font-mono text-[15px] leading-[22px]' : ''
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
                {renderActions ? (
                  <td className="px-12 py-12 text-right align-middle">{renderActions(row)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-12 md:hidden">
        {rows.map((row) => (
          <li
            key={getRowKey(row)}
            className="rounded-[16px] border border-edge bg-paper p-16 shadow-xs transition-colors duration-150 hover:bg-surface"
          >
            <dl className="flex flex-col gap-8">
              {columns.map((col) => (
                <div key={col.key} className="flex items-baseline justify-between gap-8">
                  <dt className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                    {col.header}
                  </dt>
                  <dd
                    className={`min-w-0 truncate text-right text-[16px] leading-[24px] text-body ${
                      col.mono ? 'font-mono text-[15px] leading-[22px]' : ''
                    }`}
                  >
                    {col.render(row)}
                  </dd>
                </div>
              ))}
            </dl>
            {renderActions ? <div className="mt-12">{renderActions(row)}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
