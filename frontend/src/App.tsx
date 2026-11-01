import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './components/PlaceholderPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { MODULES } from './config/modules';

import { InventoryDashboardPage } from './pages/inventory/InventoryDashboardPage';
import { ReceiptFormPage } from './pages/inventory/ReceiptFormPage';
import { IssueFormPage } from './pages/inventory/IssueFormPage';
import { TransferFormPage } from './pages/inventory/TransferFormPage';
import { AdjustmentFormPage } from './pages/inventory/AdjustmentFormPage';
import { StockInquiryPage } from './pages/inventory/StockInquiryPage';
import { MovementLedgerPage } from './pages/inventory/MovementLedgerPage';
import { DocumentsPage } from './pages/inventory/DocumentsPage';
import { ReservationsPage } from './pages/inventory/ReservationsPage';
import { SapcoMaterialsPage } from './pages/sapco/SapcoMaterialsPage';

import { ProductionPage } from './pages/production/ProductionPage';
import { MoDetailPage } from './pages/production/MoDetailPage';
import { ReportFormPage } from './pages/production/ReportFormPage';
import { ProductionTransfersPage } from './pages/production/ProductionTransfersPage';
import { WipDashboardPage } from './pages/wip/WipDashboardPage';

import { PlanningDashboardPage } from './pages/planning/PlanningDashboardPage';
import { PlanDetailPage } from './pages/planning/PlanDetailPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />

          {/* انبار — فاز ۲ */}
          <Route path="/inventory" element={<InventoryDashboardPage />} />
          <Route path="/inventory/receipts/new" element={<ReceiptFormPage />} />
          <Route path="/inventory/issues/new" element={<IssueFormPage />} />
          <Route path="/inventory/transfers/new" element={<TransferFormPage />} />
          <Route path="/inventory/adjustments/new" element={<AdjustmentFormPage />} />
          <Route path="/inventory/inquiry" element={<StockInquiryPage />} />
          <Route path="/inventory/movements" element={<MovementLedgerPage />} />
          <Route path="/inventory/documents" element={<DocumentsPage />} />
          <Route path="/inventory/reservations" element={<ReservationsPage />} />

          {/* مواد SAPCO — فاز ۲ */}
          <Route path="/sapco-materials" element={<SapcoMaterialsPage />} />

          {/* تولید و WIP — فاز ۳ */}
          <Route path="/production" element={<ProductionPage />} />
          <Route path="/production/mos/:id" element={<MoDetailPage />} />
          <Route path="/production/reports/new" element={<ReportFormPage />} />
          <Route path="/production/transfers" element={<ProductionTransfersPage />} />
          <Route path="/wip" element={<WipDashboardPage />} />

          {/* برنامه‌ریزی تولید — فاز ۴ */}
          <Route path="/production-planning" element={<PlanningDashboardPage />} />
          <Route path="/production-planning/plans/:id" element={<PlanDetailPage />} />

          {MODULES.filter((m) => m.status === 'planned').map((m) => (
            <Route
              key={m.key}
              path={m.path.slice(1)}
              element={<PlaceholderPage moduleKey={m.key} />}
            />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
