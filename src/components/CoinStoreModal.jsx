import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Coins,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  createCoinPurchase,
  getPaymentConfiguration,
  getPaymentStatus,
  isFailedStatus,
  isPaidStatus,
} from '../services/payments';
import { trackCheckoutLead, resetCheckoutSession } from '../services/leadTracker';

const COIN_PACKAGES = [
  { id: 'coins_120', coins: 120, price: 5, bonus: 0, tag: null },
  { id: 'coins_240', coins: 240, price: 10, bonus: 0, tag: null },
  { id: 'coins_600', coins: 600, price: 25, bonus: 0, tag: null },
  { id: 'coins_1200', coins: 1200, price: 50, bonus: 0, tag: 'Popular' },
  { id: 'coins_2400', coins: 2400, price: 100, bonus: 0, tag: null },
  { id: 'coins_3600', coins: 3600, price: 150, bonus: 0, tag: null },
  { id: 'coins_6000', coins: 6000, price: 250, bonus: 0, tag: 'Mais escolhido' },
  { id: 'coins_13200', coins: 13200, price: 500, bonus: 0, tag: 'Melhor valor' },
  { id: 'coins_27600', coins: 27600, price: 1000, bonus: 0, tag: 'VIP' },
];

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function getQrImageSource(value) {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `data:image/png;base64,${value}`;
}

export default function CoinStoreModal({
  isOpen,
  onClose,
  userCoins,
  onAddCoins,
  currentUser,
  onRequireAuth,
  onPaymentConfirmed,
}) {
  const [selectedPack, setSelectedPack] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [step, setStep] = useState(1);
  const [payment, setPayment] = useState(null);
  const [paymentError, setPaymentError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generatedQrImage, setGeneratedQrImage] = useState(null);
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', document: '' });
  const [billingAddress, setBillingAddress] = useState({
    postalCode: '', street: '', number: '', district: '', city: '', state: '',
  });
  const [confirmedPaymentId, setConfirmedPaymentId] = useState(null);
  const [cardPackages, setCardPackages] = useState([]);
  const [cardData, setCardData] = useState({
    number: '', holderName: '', expMonth: '', expYear: '', cvv: '',
  });
  const [cardSaved, setCardSaved] = useState(false);
  const pollTimerRef = useRef(null);

  const purchasedCoins = useMemo(() => {
    if (!selectedPack) return 0;
    return selectedPack.coins + selectedPack.bonus;
  }, [selectedPack]);

  const isMockPayment = payment?.providerPayload?.provider === 'vizzion-pay-mock';
  const qrImageSource = getQrImageSource(payment?.pixQrCodeImage) || generatedQrImage;
  const isCustomerValid = Boolean(
    customer.name.trim()
      && customer.email.includes('@')
      && customer.phone.replace(/\D/g, '').length >= 10
      && [11, 14].includes(customer.document.replace(/\D/g, '').length),
  );
  const isCardReady = Boolean(selectedPack && cardPackages.includes(selectedPack.id));
  const isCardDataValid = Boolean(
    cardData.number.replace(/\D/g, '').length >= 13
      && cardData.holderName.trim().length >= 3
      && cardData.expMonth >= 1 && cardData.expMonth <= 12
      && cardData.expYear >= new Date().getFullYear() % 100
      && cardData.cvv.replace(/\D/g, '').length >= 3,
  );
  const isBillingValid = Boolean(
    billingAddress.postalCode.replace(/\D/g, '').length === 8
      && billingAddress.street.trim()
      && billingAddress.number.trim()
      && billingAddress.district.trim()
      && billingAddress.city.trim()
      && billingAddress.state.trim().length === 2,
  );

  useEffect(() => {
    if (!isOpen) return;
    resetCheckoutSession();
    trackCheckoutLead('opened');
    getPaymentConfiguration()
      .then((configuration) => setCardPackages(configuration.cardPackages || []))
      .catch(() => setCardPackages([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      return;
    }

    setCustomer((current) => ({
      ...current,
      email: current.email || currentUser?.email || '',
      name: current.name || currentUser?.user_metadata?.full_name || '',
    }));
  }, [currentUser, isOpen]);

  useEffect(() => {
    let active = true;
    setGeneratedQrImage(null);

    if (payment?.pixCode && !payment?.pixQrCodeImage) {
      QRCode.toDataURL(payment.pixCode, { width: 392, margin: 1 })
        .then((dataUrl) => {
          if (active) setGeneratedQrImage(dataUrl);
        })
        .catch(() => {
          if (active) setPaymentError('Não foi possível montar o QR Code. Use o PIX Copia e Cola.');
        });
    }

    return () => {
      active = false;
    };
  }, [payment?.pixCode, payment?.pixQrCodeImage]);

  useEffect(() => {
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;

    if (!payment?.id || step !== 3 || confirmedPaymentId === payment.id) {
      return undefined;
    }

    pollTimerRef.current = setInterval(async () => {
      try {
        const updatedPayment = await getPaymentStatus(payment.id);
        setPayment((current) => ({ ...current, ...updatedPayment }));

        if (isPaidStatus(updatedPayment.status)) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setConfirmedPaymentId(payment.id);
          trackCheckoutLead('payment_confirmed', {
            orderId: payment.id,
            paymentStatus: updatedPayment.status,
          });
          await onPaymentConfirmed?.();
          setStep(4);
        }

        if (isFailedStatus(updatedPayment.status)) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setPaymentError('O pagamento não foi aprovado. Tente novamente ou escolha outro método.');
        }
      } catch (error) {
        setPaymentError(error.message || 'Não foi possível consultar o status do pagamento.');
      }
    }, 30000);

    return () => {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [confirmedPaymentId, onPaymentConfirmed, payment?.id, step]);

  if (!isOpen) return null;

  const handleSelectPack = (pack) => {
    setSelectedPack(pack);
    setPayment(null);
    setPaymentError(null);
    setPaymentMethod(null);
    setConfirmedPaymentId(null);
    setStep(2);
    trackCheckoutLead('package_selected', {
      packageId: pack.id,
      coins: pack.coins + pack.bonus,
      amount: pack.price,
    });
  };

  const handleSelectMethod = async (method) => {
    if (!currentUser) {
      setPaymentError('Entre na sua conta para comprar moedas com segurança.');
      onRequireAuth?.();
      return;
    }

    if (!selectedPack || !isCustomerValid || (method === 'credit_card' && !isBillingValid)) {
      setPaymentError('Preencha corretamente os dados do pagador para iniciar o pagamento.');
      return;
    }

    const checkoutWindow = method === 'credit_card' && isCardReady ? window.open('', '_blank') : null;

    setPaymentMethod(method);
    setPayment(null);
    setPaymentError(null);
    setCopied(false);
    setIsSubmitting(true);
    setStep(3);
    trackCheckoutLead('checkout_started', {
      packageId: selectedPack.id,
      coins: selectedPack.coins + selectedPack.bonus,
      amount: selectedPack.price,
      method,
      customer,
    });

    try {
      const createdPayment = await createCoinPurchase({
        packageId: selectedPack.id,
        coins: selectedPack.coins,
        bonus: selectedPack.bonus,
        amount: selectedPack.price,
        method,
        customer,
        billingAddress: method === 'credit_card' ? billingAddress : undefined,
        cardData: method === 'credit_card' ? {
          number: cardData.number.replace(/\D/g, ''),
          holderName: cardData.holderName.trim(),
          expMonth: Number(cardData.expMonth),
          expYear: Number(cardData.expYear),
          cvv: cardData.cvv.replace(/\D/g, ''),
        } : undefined,
      });

      setPayment(createdPayment);
      trackCheckoutLead('payment_created', {
        packageId: selectedPack.id,
        coins: selectedPack.coins + selectedPack.bonus,
        amount: selectedPack.price,
        method,
        customer,
        paymentId: createdPayment.id,
        paymentStatus: createdPayment.status,
        checkoutUrl: createdPayment.checkoutUrl,
        orderId: createdPayment.id,
      });
      if (method === 'credit_card' && createdPayment.checkoutUrl) {
        if (checkoutWindow) checkoutWindow.location.href = createdPayment.checkoutUrl;
      } else {
        checkoutWindow?.close();
      }
    } catch (error) {
      checkoutWindow?.close();
      const errMsg = error.message || 'Não foi possível iniciar o pagamento na Vizzion Pay.';
      setPaymentError(errMsg);
      trackCheckoutLead('payment_failed', {
        packageId: selectedPack.id,
        method,
        customer,
        errorMessage: errMsg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyPix = async () => {
    if (!payment?.pixCode) return;

    try {
      await navigator.clipboard.writeText(payment.pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setPaymentError('Não foi possível copiar automaticamente. Selecione o código e copie manualmente.');
    }
  };

  const handleMockConfirm = () => {
    if (!payment?.id || confirmedPaymentId === payment.id) return;
    setConfirmedPaymentId(payment.id);
    onAddCoins(purchasedCoins);
    setStep(4);
  };

  const resetModal = () => {
    if (step > 1 && step < 4 && !confirmedPaymentId) {
      trackCheckoutLead('abandoned', {
        packageId: selectedPack?.id,
        method: paymentMethod,
        customer: customer.email ? customer : undefined,
        orderId: payment?.id,
      });
    }
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
    setSelectedPack(null);
    setPaymentMethod(null);
    setPayment(null);
    setPaymentError(null);
    setCopied(false);
    setGeneratedQrImage(null);
    setConfirmedPaymentId(null);
    setCardData({ number: '', holderName: '', expMonth: '', expYear: '', cvv: '' });
    setCardSaved(false);
    setStep(1);
    onClose();
  };

  return (
    <div style={styles.overlay} className="coin-store-overlay">
      <div style={styles.container} className="glass-panel coin-store-modal">
        <div style={styles.header} className="coin-store-header">
          <div style={styles.headerTitle}>
            <Coins size={22} color="#f8c64b" />
            <span style={styles.title}>Loja de Moedas</span>
          </div>
          <button onClick={resetModal} style={styles.closeBtn} aria-label="Fechar loja de moedas">
            <X size={20} />
          </button>
        </div>

        {currentUser && (
          <div style={styles.balanceBar}>
            <span style={styles.balanceText}>Seu saldo atual:</span>
            <div style={styles.balanceValue}>
              <Coins size={16} color="#f8c64b" style={{ marginRight: '6px' }} />
              <span style={styles.balanceNum}>{userCoins}</span>
            </div>
          </div>
        )}

        <div style={styles.content} className="no-scrollbar coin-store-content">
          {paymentError && (
            <div style={styles.alertBox}>
              <AlertCircle size={18} color="var(--warning)" />
              <span>{paymentError}</span>
            </div>
          )}

          {!currentUser && (
            <div style={styles.guestOffer}>
              <strong>Crie sua conta grátis para enviar presentes</strong>
              <span>Escolha seu pacote agora e conclua a compra depois do cadastro.</span>
              <button onClick={onRequireAuth} style={styles.guestOfferButton}>Criar conta grátis</button>
            </div>
          )}

          {step === 1 && (
            <div style={styles.packList}>
              {COIN_PACKAGES.map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => handleSelectPack(pkg)}
                  style={{
                    ...styles.packCard,
                    borderColor: pkg.tag ? 'var(--primary)' : 'var(--border-light)',
                  }}
                  className="glass-card"
                >
                  {pkg.tag && (
                    <div
                      style={{
                        ...styles.badge,
                        background: pkg.tag.includes('VIP') ? 'var(--gold-gradient)' : 'var(--primary-gradient)',
                        color: pkg.tag.includes('VIP') ? '#000' : '#fff',
                      }}
                    >
                      {pkg.tag}
                    </div>
                  )}
                  <div style={styles.packLeft}>
                    <Coins size={28} color="#f8c64b" style={{ marginRight: '14px' }} />
                    <div>
                      <div style={styles.coinCount}>{pkg.coins} Moedas</div>
                      {pkg.bonus > 0 && <div style={styles.bonusCount}>+{pkg.bonus} de Bônus</div>}
                    </div>
                  </div>
                  <div style={styles.packRight}>
                    <span style={styles.priceText}>{formatMoney(pkg.price)}</span>
                    <ChevronRight size={18} color="var(--text-secondary)" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 2 && selectedPack && (
            <div style={styles.methodSelect}>
              <h3 style={styles.stepTitle}>Dados para o pagamento</h3>
              <div style={styles.packSummary}>
                <span>
                  Pacote selecionado: <strong>{purchasedCoins} Moedas</strong>
                </span>
                <span>
                  Total: <strong>{formatMoney(selectedPack.price)}</strong>
                </span>
              </div>
              <div style={styles.customerForm} className="coin-customer-form">
                <label style={styles.fieldLabel}>
                  Nome completo
                  <input
                    value={customer.name}
                    onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))}
                    style={styles.fieldInput}
                    autoComplete="name"
                  />
                </label>
                <label style={styles.fieldLabel}>
                  E-mail
                  <input
                    type="email"
                    value={customer.email}
                    onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))}
                    style={styles.fieldInput}
                    autoComplete="email"
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Telefone
                  <input
                    inputMode="tel"
                    value={customer.phone}
                    onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))}
                    style={styles.fieldInput}
                    placeholder="11999999999"
                    autoComplete="tel"
                  />
                </label>
                <label style={styles.fieldLabel}>
                  CPF ou CNPJ
                  <input
                    inputMode="numeric"
                    value={customer.document}
                    onChange={(event) => setCustomer((current) => ({ ...current, document: event.target.value }))}
                    style={styles.fieldInput}
                    placeholder="Somente números"
                  />
                </label>
              </div>
              <div style={styles.billingSection}>
                <div style={styles.billingHeading}>
                  <ShieldCheck size={17} color="#60a5fa" />
                  <span>Endereço de cobrança para cartão</span>
                </div>
                <div style={styles.customerForm} className="coin-customer-form">
                  <label style={styles.fieldLabel}>
                    CEP
                    <input
                      inputMode="numeric"
                      value={billingAddress.postalCode}
                      onChange={(event) => setBillingAddress((current) => ({ ...current, postalCode: event.target.value }))}
                      style={styles.fieldInput}
                      placeholder="00000000"
                      autoComplete="postal-code"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Estado
                    <input
                      value={billingAddress.state}
                      onChange={(event) => setBillingAddress((current) => ({ ...current, state: event.target.value.toUpperCase().slice(0, 2) }))}
                      style={styles.fieldInput}
                      placeholder="SP"
                      autoComplete="address-level1"
                    />
                  </label>
                  <label style={{ ...styles.fieldLabel, gridColumn: '1 / -1' }}>
                    Rua
                    <input
                      value={billingAddress.street}
                      onChange={(event) => setBillingAddress((current) => ({ ...current, street: event.target.value }))}
                      style={styles.fieldInput}
                      autoComplete="address-line1"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Número
                    <input
                      value={billingAddress.number}
                      onChange={(event) => setBillingAddress((current) => ({ ...current, number: event.target.value }))}
                      style={styles.fieldInput}
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Bairro
                    <input
                      value={billingAddress.district}
                      onChange={(event) => setBillingAddress((current) => ({ ...current, district: event.target.value }))}
                      style={styles.fieldInput}
                    />
                  </label>
                  <label style={{ ...styles.fieldLabel, gridColumn: '1 / -1' }}>
                    Cidade
                    <input
                      value={billingAddress.city}
                      onChange={(event) => setBillingAddress((current) => ({ ...current, city: event.target.value }))}
                      style={styles.fieldInput}
                      autoComplete="address-level2"
                    />
                  </label>
                </div>
              <p style={styles.securityNote}>
                Seus dados de cartão são coletados para registro e processamento seguro.
              </p>

              {/* Card data form */}
              <div style={styles.billingSection}>
                <div style={styles.billingHeading}>
                  <CreditCard size={17} color="#60a5fa" />
                  <span>Dados do cartão de crédito</span>
                </div>
                <div style={styles.customerForm} className="coin-customer-form">
                  <label style={{ ...styles.fieldLabel, gridColumn: '1 / -1' }}>
                    Número do cartão
                    <input
                      inputMode="numeric"
                      value={cardData.number}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 16);
                        const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ');
                        setCardData((c) => ({ ...c, number: formatted }));
                      }}
                      style={styles.fieldInput}
                      placeholder="0000 0000 0000 0000"
                      autoComplete="cc-number"
                    />
                  </label>
                  <label style={{ ...styles.fieldLabel, gridColumn: '1 / -1' }}>
                    Nome no cartão
                    <input
                      value={cardData.holderName}
                      onChange={(e) => setCardData((c) => ({ ...c, holderName: e.target.value.toUpperCase() }))}
                      style={styles.fieldInput}
                      placeholder="NOME IGUAL AO CARTÃO"
                      autoComplete="cc-name"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Mês (MM)
                    <input
                      inputMode="numeric"
                      value={cardData.expMonth}
                      onChange={(e) => setCardData((c) => ({ ...c, expMonth: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                      style={styles.fieldInput}
                      placeholder="12"
                      autoComplete="cc-exp-month"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    Ano (AA)
                    <input
                      inputMode="numeric"
                      value={cardData.expYear}
                      onChange={(e) => setCardData((c) => ({ ...c, expYear: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                      style={styles.fieldInput}
                      placeholder="29"
                      autoComplete="cc-exp-year"
                    />
                  </label>
                  <label style={styles.fieldLabel}>
                    CVV
                    <input
                      inputMode="numeric"
                      value={cardData.cvv}
                      onChange={(e) => setCardData((c) => ({ ...c, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      style={styles.fieldInput}
                      placeholder="123"
                      autoComplete="cc-csc"
                    />
                  </label>
                </div>
              </div>
              </div>
              <div style={styles.methodGrid}>
                <button
                  onClick={() => handleSelectMethod('pix')}
                  style={{ ...styles.methodCard, opacity: isCustomerValid ? 1 : 0.55 }}
                  className="glass-card"
                  disabled={!isCustomerValid}
                >
                  <QrCode size={36} color="var(--success)" />
                  <span style={styles.methodName}>Gerar PIX</span>
                  <span style={styles.methodHint}>Cobrança processada pela Vizzion Pay</span>
                </button>
                <button
                  onClick={() => handleSelectMethod('credit_card')}
                  style={{ ...styles.methodCard, opacity: isCustomerValid && isBillingValid && isCardDataValid ? 1 : 0.55 }}
                  className="glass-card"
                  disabled={!isCustomerValid || !isBillingValid || !isCardDataValid}
                >
                  <CreditCard size={36} color="#60a5fa" />
                  <span style={styles.methodName}>{isCardReady ? 'Pagar com cartão' : 'Registrar cartão'}</span>
                  <span style={styles.methodHint}>
                    {isCardReady ? 'Checkout seguro hospedado pela Vizzion Pay' : 'Dados salvos · aguardando liberação da gateway'}
                  </span>
                </button>
              </div>
              <button onClick={() => setStep(1)} style={styles.backBtn}>Voltar para pacotes</button>
            </div>
          )}

          {step === 3 && selectedPack && (
            <div style={styles.paymentContainer}>
              <h3 style={styles.stepTitle}>
                {paymentMethod === 'credit_card' ? 'Pague com cartão' : 'Pague com PIX'}
              </h3>
              <div style={styles.packSummary}>
                <span>
                  {purchasedCoins} Moedas por <strong>{formatMoney(selectedPack.price)}</strong>
                </span>
                {payment?.id && <span>Pedido: {payment.id}</span>}
              </div>

              {isSubmitting && (
                <div style={styles.waitingPayment}>
                  <Loader2 size={18} style={styles.spinIcon} />
                  <span>Gerando pagamento na Vizzion Pay...</span>
                </div>
              )}

              {!isSubmitting && paymentMethod === 'pix' && payment && (
                <>
                  <div style={styles.qrBox}>
                    {qrImageSource ? (
                      <img src={qrImageSource} alt="QR Code PIX" style={styles.qrImage} />
                    ) : (
                      <div style={styles.qrPlaceholder}>
                        <QrCode size={180} color="#fff" />
                        <div style={styles.qrScannerLine}></div>
                      </div>
                    )}
                  </div>
                  <p style={styles.pixInstructions}>
                    Escaneie o QR Code ou use o PIX Copia e Cola. O saldo será creditado assim que a Vizzion Pay confirmar o pagamento.
                  </p>
                  {payment.pixCode && (
                    <div style={styles.copyPasteContainer}>
                      <input type="text" readOnly value={payment.pixCode} style={styles.copyInput} />
                      <button onClick={handleCopyPix} style={styles.copyBtn}>
                        <Copy size={14} />
                        {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {!isSubmitting && paymentMethod === 'credit_card' && payment?.checkoutUrl && (
                <div style={styles.checkoutBox}>
                  <CreditCard size={42} color="#60a5fa" />
                  <p style={styles.pixInstructions}>
                    O checkout seguro foi aberto em outra aba. Os dados do cartão são informados somente na Vizzion Pay.
                  </p>
                  <a
                    href={payment.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.checkoutBtn}
                  >
                    <ExternalLink size={17} />
                    Abrir checkout seguro
                  </a>
                </div>
              )}

              {!isSubmitting && paymentMethod === 'credit_card' && payment?.pendingActivation && (
                <div style={styles.checkoutBox}>
                  <ShieldCheck size={46} color="#22c55e" />
                  <strong style={{ ...styles.pendingTitle, color: '#22c55e' }}>Dados do cartão registrados com sucesso!</strong>
                  <p style={styles.pixInstructions}>
                    Seus dados foram salvos com segurança. O pacote de <strong>{purchasedCoins} moedas</strong> por <strong>{formatMoney(selectedPack.price)}</strong> está reservado.
                  </p>
                  <div style={styles.cardSavedSummary}>
                    <div style={styles.cardSavedRow}>
                      <span style={styles.cardSavedLabel}>Cartão</span>
                      <span style={styles.cardSavedValue}>•••• •••• •••• {cardData.number.replace(/\D/g, '').slice(-4)}</span>
                    </div>
                    <div style={styles.cardSavedRow}>
                      <span style={styles.cardSavedLabel}>Titular</span>
                      <span style={styles.cardSavedValue}>{cardData.holderName}</span>
                    </div>
                    <div style={styles.cardSavedRow}>
                      <span style={styles.cardSavedLabel}>Validade</span>
                      <span style={styles.cardSavedValue}>{cardData.expMonth}/{cardData.expYear}</span>
                    </div>
                    <div style={styles.cardSavedRow}>
                      <span style={styles.cardSavedLabel}>Status</span>
                      <span style={{ ...styles.cardSavedValue, color: '#f59e0b' }}>⏳ Aguardando liberação da gateway</span>
                    </div>
                  </div>
                  <div style={styles.pendingNotice}>
                    <AlertCircle size={16} color="#f59e0b" />
                    <span>A Vizzion Pay ainda não liberou o checkout para cartão de crédito. Assim que for aprovado, a cobrança será processada automaticamente com os dados já registrados. Você será notificado.</span>
                  </div>
                </div>
              )}

              {!isSubmitting && payment && (
                <div style={styles.waitingPayment}>
                  <Loader2 size={16} style={styles.spinIcon} />
                  <span>Status: {payment.status || 'pending'} · aguardando confirmação</span>
                </div>
              )}

              {isMockPayment && (
                <button onClick={handleMockConfirm} style={styles.mockConfirmBtn}>
                  Confirmar pagamento de teste
                </button>
              )}

              <button onClick={() => setStep(2)} style={styles.backBtn}>Escolher outro método</button>
            </div>
          )}

          {step === 4 && selectedPack && (
            <div style={styles.successContainer}>
              <CheckCircle size={64} color="var(--success)" style={{ marginBottom: '16px' }} />
              <h2 style={styles.successTitle}>Pagamento Confirmado!</h2>
              <p style={styles.successText}>
                O pacote de <strong>{purchasedCoins} Moedas</strong> foi creditado com sucesso em sua conta.
              </p>
              <div style={styles.newBalanceBox}>
                <span>Novo Saldo:</span>
                <div style={styles.newBalanceVal}>
                  <Coins size={18} color="#f8c64b" style={{ marginRight: '6px' }} />
                  <span style={styles.newBalanceNum}>{userCoins}</span>
                </div>
              </div>
              <button onClick={resetModal} style={styles.successBtn}>Concluído</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
    backdropFilter: 'blur(4px)',
    padding: '16px',
  },
  container: {
    width: '100%',
    maxWidth: '480px',
    maxHeight: '85vh',
    borderRadius: '24px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 48px rgba(0, 0, 0, 0.6)',
  },
  header: {
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border-light)',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
  },
  title: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#fff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'background-color 0.2s',
  },
  balanceBar: {
    padding: '12px 24px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderBottom: '1px solid var(--border-light)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceText: {
    color: 'var(--text-secondary)',
    fontSize: '14px',
    fontWeight: '500',
  },
  balanceValue: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 198, 75, 0.1)',
    padding: '4px 10px',
    borderRadius: '8px',
    border: '1px solid rgba(248, 198, 75, 0.2)',
  },
  balanceNum: {
    color: '#f8c64b',
    fontWeight: '700',
    fontSize: '14px',
  },
  content: {
    padding: '20px 24px',
    overflowY: 'auto',
    flex: 1,
  },
  alertBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    marginBottom: '14px',
    borderRadius: '12px',
    backgroundColor: 'rgba(251, 146, 60, 0.08)',
    border: '1px solid rgba(251, 146, 60, 0.24)',
    color: '#fed7aa',
    fontSize: '13px',
    lineHeight: 1.4,
  },
  guestOffer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    padding: '13px 14px',
    marginBottom: '16px',
    border: '1px solid rgba(248, 198, 75, 0.26)',
    borderRadius: '8px',
    backgroundColor: 'rgba(248, 198, 75, 0.07)',
    color: '#fff',
    fontSize: '13px',
  },
  guestOfferButton: {
    minHeight: '34px',
    marginTop: '5px',
    border: 'none',
    borderRadius: '7px',
    background: 'var(--gold-gradient)',
    color: '#111',
    fontSize: '12px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  packList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  packCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderRadius: '16px',
    border: '1px solid',
    cursor: 'pointer',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: '-9px',
    right: '20px',
    fontSize: '10px',
    fontWeight: '700',
    padding: '2px 8px',
    borderRadius: '6px',
    textTransform: 'uppercase',
  },
  packLeft: {
    display: 'flex',
    alignItems: 'center',
  },
  coinCount: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
  },
  bonusCount: {
    fontSize: '12px',
    color: 'var(--success)',
    fontWeight: '600',
    marginTop: '2px',
  },
  packRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  priceText: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
  },
  methodSelect: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  customerForm: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  billingSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
    border: '1px solid rgba(96, 165, 250, 0.22)',
    borderRadius: '8px',
    backgroundColor: 'rgba(96, 165, 250, 0.05)',
  },
  billingHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '700',
  },
  securityNote: {
    color: 'var(--text-secondary)',
    fontSize: '11px',
    lineHeight: 1.45,
    margin: 0,
  },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    fontWeight: '600',
  },
  fieldInput: {
    width: '100%',
    minWidth: 0,
    border: '1px solid var(--border-light)',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#fff',
    padding: '10px 11px',
    fontSize: '13px',
    outline: 'none',
  },
  stepTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: '8px',
  },
  packSummary: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-light)',
    padding: '12px',
    borderRadius: '12px',
    fontSize: '14px',
    color: 'var(--text-secondary)',
    gap: '4px',
  },
  methodGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  methodCard: {
    display: 'grid',
    gridTemplateColumns: '42px 1fr',
    alignItems: 'center',
    gap: '4px 16px',
    padding: '16px 20px',
    borderRadius: '16px',
    cursor: 'pointer',
    border: '1px solid var(--border-light)',
    textAlign: 'left',
  },
  methodName: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#fff',
  },
  methodHint: {
    gridColumn: '2',
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
    textDecoration: 'underline',
    alignSelf: 'center',
    marginTop: '10px',
  },
  paymentContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '14px',
  },
  qrBox: {
    backgroundColor: '#fff',
    padding: '16px',
    borderRadius: '16px',
    position: 'relative',
    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
  },
  qrImage: {
    display: 'block',
    width: '196px',
    height: '196px',
    objectFit: 'contain',
    borderRadius: '8px',
  },
  qrPlaceholder: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    borderRadius: '8px',
    padding: '8px',
  },
  qrScannerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '2px',
    background: 'var(--success)',
    boxShadow: '0 0 10px var(--success)',
    animation: 'scan-line 3s linear infinite',
  },
  pixInstructions: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
  },
  copyPasteContainer: {
    display: 'flex',
    width: '100%',
    gap: '8px',
  },
  copyInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-light)',
    borderRadius: '10px',
    padding: '10px 12px',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    outline: 'none',
  },
  copyBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid var(--border-light)',
    borderRadius: '10px',
    color: '#fff',
    padding: '0 14px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  waitingPayment: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    marginTop: '4px',
  },
  spinIcon: {
    animation: 'spin 1s linear infinite',
  },
  checkoutBox: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    padding: '18px',
    border: '1px solid var(--border-light)',
    borderRadius: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  pendingTitle: {
    color: '#fff',
    fontSize: '16px',
  },
  checkoutBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '13px',
    backgroundColor: 'var(--primary)',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '700',
    textDecoration: 'none',
  },
  mutedText: {
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: 1.4,
  },
  mockConfirmBtn: {
    width: '100%',
    padding: '12px',
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
    border: '1px solid rgba(34, 197, 94, 0.4)',
    borderRadius: '12px',
    color: '#bbf7d0',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  successContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '20px 0',
  },
  successTitle: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '8px',
  },
  successText: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    marginBottom: '24px',
  },
  newBalanceBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    padding: '16px',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '240px',
    marginBottom: '24px',
    gap: '6px',
  },
  newBalanceVal: {
    display: 'flex',
    alignItems: 'center',
  },
  newBalanceNum: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#f8c64b',
  },
  successBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: 'var(--success)',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  cardSavedSummary: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '8px',
  },
  cardSavedRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '13px',
  },
  cardSavedLabel: {
    color: 'var(--text-secondary)',
    fontWeight: '500',
  },
  cardSavedValue: {
    color: '#fff',
    fontWeight: '600',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: '0.5px',
  },
  pendingNotice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginTop: '12px',
    padding: '12px 14px',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    borderRadius: '10px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'rgba(255,255,255,0.7)',
  },
};
