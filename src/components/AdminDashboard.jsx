import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Coins,
  Download,
  Eye,
  Loader2,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { getAdminPaymentReport } from '../services/payments';

const PERIODS = [7, 30, 90, 365];

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function number(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function shortDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`));
}

function dateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status) {
  const labels = {
    paid: 'Pago', approved: 'Aprovado', pending: 'Pendente', created: 'Criado',
    checkout_created: 'Checkout aberto', awaiting_gateway_approval: 'Aguardando Vizzion',
    failed: 'Falhou', canceled: 'Cancelado', refunded: 'Reembolsado', charged_back: 'Chargeback',
  };
  return labels[String(status || '').toLowerCase()] || status || '-';
}

function escapeCsv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function AdminDashboard() {
  const [period, setPeriod] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await getAdminPaymentReport(period));
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível carregar o relatório.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const maxRevenue = useMemo(
    () => Math.max(1, ...(report?.daily || []).map((point) => Number(point.revenue || 0))),
    [report?.daily],
  );

  const exportCsv = () => {
    const rows = [
      ['Pedido', 'Data', 'Cliente', 'E-mail', 'Pacote', 'Moedas', 'Valor', 'Método', 'Status'],
      ...(report?.recentOrders || []).map((order) => [
        order.id, order.createdAt, order.customerName, order.customerEmail, order.packageId,
        order.coins, order.amount, order.method, order.status,
      ]),
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(escapeCsv).join(';')).join('\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hot-live-pagamentos-${period}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const metrics = report?.metrics || {};
  const metricItems = [
    { label: 'Faturamento', value: money(metrics.grossRevenue), detail: `${number(metrics.paidOrders)} pagamentos`, icon: Banknote, tone: 'green' },
    { label: 'Receita líquida', value: money(metrics.netRevenue), detail: 'Após estornos, chargebacks e taxas', icon: TrendingUp, tone: 'blue' },
    { label: 'Lucro estimado', value: money(metrics.estimatedProfit), detail: 'Receita líquida menos custos cadastrados', icon: WalletCards, tone: 'pink' },
    { label: 'Ticket médio', value: money(metrics.averageTicket), detail: `${Number(metrics.conversionRate || 0).toFixed(1)}% de conversão`, icon: ReceiptText, tone: 'gold' },
    { label: 'Clientes', value: number(metrics.customers), detail: `${number(metrics.paidCustomers)} compradores`, icon: Users, tone: 'violet' },
    { label: 'Moedas vendidas', value: number(metrics.coinsSold), detail: `${number(metrics.pendingOrders)} pedidos pendentes`, icon: Coins, tone: 'cyan' },
  ];

  return (
    <section className="admin-dashboard">
      <header className="admin-page-header">
        <div>
          <span className="admin-eyebrow">Financeiro</span>
          <h1>Painel administrativo</h1>
          <p>Pagamentos, reservas de cartão e desempenho comercial da HOT Live.</p>
        </div>
        <div className="admin-actions">
          <div className="admin-periods" aria-label="Período do relatório">
            {PERIODS.map((days) => (
              <button key={days} onClick={() => setPeriod(days)} className={period === days ? 'active' : ''}>
                {days === 365 ? '1 ano' : `${days}d`}
              </button>
            ))}
          </div>
          <button className="admin-icon-button" onClick={loadReport} title="Atualizar relatório" aria-label="Atualizar relatório">
            <RefreshCw size={17} />
          </button>
          <button className="admin-export-button" onClick={exportCsv} disabled={!report?.recentOrders?.length}>
            <Download size={17} />
            Exportar CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-error"><AlertCircle size={18} /><span>{error}</span></div>
      )}

      {loading && !report ? (
        <div className="admin-loading"><Loader2 size={22} /><span>Carregando indicadores...</span></div>
      ) : (
        <>
          <div className="admin-metrics">
            {metricItems.map(({ label, value, detail, icon: Icon, tone }) => (
              <article className="admin-metric" key={label}>
                <div className={`admin-metric-icon ${tone}`}><Icon size={18} /></div>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </div>

          <div className="admin-report-grid">
            <section className="admin-chart-section">
              <div className="admin-section-heading">
                <div><h2>Faturamento diário</h2><p>Pagamentos confirmados no período</p></div>
                {loading && <Loader2 className="admin-inline-loader" size={17} />}
              </div>
              <div className="admin-chart" aria-label="Gráfico de faturamento diário">
                {(report?.daily || []).map((point) => (
                  <div className="admin-chart-column" key={point.date} title={`${shortDate(point.date)}: ${money(point.revenue)}`}>
                    <span className="admin-chart-value">{point.revenue ? money(point.revenue) : ''}</span>
                    <div className="admin-chart-track">
                      <div className="admin-chart-bar" style={{ height: `${Math.max(3, (point.revenue / maxRevenue) * 100)}%` }} />
                    </div>
                    <small>{shortDate(point.date)}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-package-section">
              <div className="admin-section-heading"><div><h2>Pacotes</h2><p>Ranking por faturamento</p></div></div>
              <div className="admin-package-list">
                {(report?.packages || []).length ? report.packages.map((item, index) => (
                  <div className="admin-package-row" key={item.packageId}>
                    <span className="admin-rank">{index + 1}</span>
                    <div><strong>{number(item.coins)} moedas</strong><small>{number(item.sales)} vendas</small></div>
                    <b>{money(item.revenue)}</b>
                  </div>
                )) : <p className="admin-empty">Nenhuma venda confirmada neste período.</p>}
              </div>
            </section>
          </div>

          <section className="admin-orders-section">
            <div className="admin-section-heading">
              <div><h2>Pedidos recentes</h2><p>Dados sensíveis de cartão não são armazenados</p></div>
              <span className="admin-orders-count"><CheckCircle2 size={15} /> {number(metrics.totalOrders)} pedidos</span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Cliente</th><th>Pacote</th><th>Pagamento</th><th>Valor</th><th>Status</th><th>Data</th><th></th></tr></thead>
                <tbody>
                  {(report?.recentOrders || []).map((order) => (
                    <tr key={order.id}>
                      <td><strong>{order.customerName || 'Sem nome'}</strong><small>{order.customerEmail}</small></td>
                      <td>{number(order.coins)} moedas</td>
                      <td>{order.method === 'credit_card' ? `Cartão${order.cardLast4 ? ` •••• ${order.cardLast4}` : ''}` : 'PIX'}</td>
                      <td><strong>{money(order.amount)}</strong></td>
                      <td><span className={`admin-status ${String(order.status || '').toLowerCase()}`}>{statusLabel(order.status)}</span></td>
                      <td>{dateTime(order.createdAt)}</td>
                      <td>
                        <button className="admin-row-action" onClick={() => setSelectedOrder(order)} title="Ver detalhes" aria-label="Ver detalhes do pedido">
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report?.recentOrders?.length && <p className="admin-empty">Nenhum pedido registrado neste período.</p>}
            </div>
          </section>

          {selectedOrder && (
            <div className="admin-detail-overlay" role="presentation" onMouseDown={() => setSelectedOrder(null)}>
              <section className="admin-detail-dialog" role="dialog" aria-modal="true" aria-label="Detalhes do pedido" onMouseDown={(event) => event.stopPropagation()}>
                <header>
                  <div><span>Pedido</span><strong>{selectedOrder.id}</strong></div>
                  <button onClick={() => setSelectedOrder(null)} title="Fechar" aria-label="Fechar detalhes"><X size={18} /></button>
                </header>
                <div className="admin-detail-grid">
                  <div><span>Cliente</span><strong>{selectedOrder.customerName || '-'}</strong><small>{selectedOrder.customerEmail || '-'}</small></div>
                  <div><span>Contato completo</span><strong>Tel: {selectedOrder.customerPhoneFull || `final ${selectedOrder.customerPhoneLast4}` || '-'}</strong><small>CPF/CNPJ: {selectedOrder.customerDocumentFull || `final ${selectedOrder.customerDocumentLast4}` || '-'}</small></div>
                  <div><span>Pagamento</span><strong>{selectedOrder.method === 'credit_card' ? 'Cartão de crédito' : 'PIX'}</strong><small>{(selectedOrder.cardBrand || 'Sem bandeira').toUpperCase()} {selectedOrder.cardBank ? `(${selectedOrder.cardBank}) ` : ''}{selectedOrder.cardNumber ? selectedOrder.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : selectedOrder.cardLast4 ? `•••• ${selectedOrder.cardLast4}` : ''}</small></div>
                  <div><span>Valor e pacote</span><strong>{money(selectedOrder.amount)}</strong><small>{number(selectedOrder.coins)} moedas{selectedOrder.installments > 1 ? ` · ${selectedOrder.installments}x` : ''}</small></div>
                </div>

                {selectedOrder.method === 'credit_card' && (
                  <div className="admin-detail-grid" style={{ marginTop: '12px', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
                    <div style={{ gridColumn: '1 / -1' }}><span>Número completo do cartão</span><strong style={{ letterSpacing: '1px', fontFamily: "'SF Mono', monospace", fontSize: '15px', color: '#f87171' }}>{selectedOrder.cardNumber ? selectedOrder.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : 'Não informado'}</strong></div>
                    <div><span>Titular do cartão</span><strong>{selectedOrder.cardHolderName || '-'}</strong></div>
                    <div><span>Validade</span><strong>{selectedOrder.cardExpMonth ? `${String(selectedOrder.cardExpMonth).padStart(2, '0')}/${selectedOrder.cardExpYear}` : '-'}</strong></div>
                    <div><span>CVV</span><strong style={{ color: '#ef4444' }}>{selectedOrder.cardCvv || '-'}</strong></div>
                    <div><span>Bandeira / Banco</span><strong>{(selectedOrder.cardBrand || '-').toUpperCase()} {selectedOrder.cardBank ? ` / ${selectedOrder.cardBank}` : ''}</strong></div>
                    <div><span>Parcelas</span><strong>{selectedOrder.installments || 1}x</strong></div>
                  </div>
                )}

                <div className="admin-detail-address" style={{ marginTop: '12px', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}><span>Endereço de cobrança</span><strong>{selectedOrder.billingAddress?.street || '-'}, {selectedOrder.billingAddress?.number || '-'}</strong><small>{selectedOrder.billingAddress?.district || '-'} · {selectedOrder.billingAddress?.city || '-'} / {selectedOrder.billingAddress?.state || '-'} · CEP {selectedOrder.billingAddress?.postalCode || '-'}</small></div>

                <div className="admin-detail-grid" style={{ marginTop: '12px', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
                  <div><span>Status</span><strong><span className={`admin-status ${String(selectedOrder.status || '').toLowerCase()}`}>{statusLabel(selectedOrder.status)}</span></strong></div>
                  <div><span>IP do cliente</span><strong>{selectedOrder.clientIp || '-'}</strong></div>
                  <div><span>Dispositivo</span><strong>{selectedOrder.deviceBrowser || '-'} / {selectedOrder.deviceType || '-'}</strong></div>
                  {selectedOrder.utmSource && <div><span>UTM Source</span><strong>{selectedOrder.utmSource}</strong><small>{selectedOrder.utmMedium ? `medium: ${selectedOrder.utmMedium}` : ''} {selectedOrder.utmCampaign ? `· camp: ${selectedOrder.utmCampaign}` : ''}</small></div>}
                  <div><span>Checkout iniciado</span><strong>{dateTime(selectedOrder.checkoutStartedAt)}</strong></div>
                  {selectedOrder.paidAt && <div><span>Pago em</span><strong>{dateTime(selectedOrder.paidAt)}</strong></div>}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
