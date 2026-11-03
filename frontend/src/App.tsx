import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';

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
import { MrpPage } from './pages/planning/MrpPage';
import { PlanDetailPage } from './pages/planning/PlanDetailPage';

import { ReportsIndexPage } from './pages/reports/ReportsIndexPage';
import { ReportViewerPage } from './pages/reports/ReportViewerPage';

// اطلاعات پایه — فاز ۶
import { MasterDataHomePage } from './pages/masterdata/MasterDataHomePage';
import { PartsPage } from './pages/masterdata/PartsPage';
import { MaterialsPage } from './pages/masterdata/MaterialsPage';
import { CustomersPage } from './pages/masterdata/CustomersPage';
import { OperationsPage } from './pages/masterdata/OperationsPage';
import { UnitsPage } from './pages/masterdata/UnitsPage';
import { WarehousesPage, WarehouseLocationsPage } from './pages/masterdata/WarehousesPage';
import { ShiftsPage } from './pages/masterdata/ShiftsPage';
import { RoutesPage } from './pages/masterdata/RoutesPage';
import { BomPage } from './pages/masterdata/BomPage';

// ماشین‌آلات و ظرفیت — فاز ۶
import { MachinesPage } from './pages/machines/MachinesPage';
import { DiesPage } from './pages/machines/DiesPage';
import { CapacityPage } from './pages/machines/CapacityPage';

// کاربران و تنظیمات — فاز ۶
import { SettingsHomePage } from './pages/settings/SettingsHomePage';
import { UsersPage } from './pages/settings/UsersPage';
import { RolesPage } from './pages/settings/RolesPage';
import { SequencesPage, SystemSettingsPage } from './pages/settings/SequencesPage';
import { AISettingsPage } from './pages/settings/AISettingsPage';
import { AuditLogsPage } from './pages/settings/AuditLogsPage';

// رول‌ها و لوت‌های ماده اولیه — فاز ۷
import { LotsPage } from './pages/inventory/LotsPage';

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
          <Route path="/inventory/lots" element={<LotsPage />} />

          {/* قراردادها و مواد تأمین‌کننده — فاز ۲ */}
          <Route path="/sapco-materials" element={<SapcoMaterialsPage />} />

          {/* تولید و WIP — فاز ۳ */}
          <Route path="/production" element={<ProductionPage />} />
          <Route path="/production/mos/:id" element={<MoDetailPage />} />
          <Route path="/production/reports/new" element={<ReportFormPage />} />
          <Route path="/production/transfers" element={<ProductionTransfersPage />} />
          <Route path="/wip" element={<WipDashboardPage />} />

          {/* برنامه‌ریزی تولید — فاز ۴ و MRP فاز ۸ */}
          <Route path="/production-planning" element={<PlanningDashboardPage />} />
          <Route path="/production-planning/mrp" element={<MrpPage />} />
          <Route path="/production-planning/plans/:id" element={<PlanDetailPage />} />

          {/* گزارش‌های مدیریتی — فاز ۵ */}
          <Route path="/reports" element={<ReportsIndexPage />} />
          <Route path="/reports/:key" element={<ReportViewerPage />} />

          {/* اطلاعات پایه — فاز ۶ */}
          <Route path="/master-data" element={<MasterDataHomePage />} />
          <Route path="/master-data/parts" element={<PartsPage />} />
          <Route path="/master-data/materials" element={<MaterialsPage />} />
          <Route path="/master-data/bom" element={<BomPage />} />
          <Route path="/master-data/routes" element={<RoutesPage />} />
          <Route path="/master-data/operations" element={<OperationsPage />} />
          <Route path="/master-data/warehouses" element={<WarehousesPage />} />
          <Route path="/master-data/warehouse-locations" element={<WarehouseLocationsPage />} />
          <Route path="/master-data/units" element={<UnitsPage />} />
          <Route path="/master-data/shifts" element={<ShiftsPage />} />
          <Route path="/master-data/customers" element={<CustomersPage />} />

          {/* ماشین‌آلات و ظرفیت — فاز ۶ */}
          <Route path="/machines" element={<MachinesPage />} />
          <Route path="/machines/dies" element={<DiesPage />} />
          <Route path="/machines/capacity" element={<CapacityPage />} />

          {/* کاربران و تنظیمات — فاز ۶ */}
          <Route path="/settings" element={<SettingsHomePage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/roles" element={<RolesPage />} />
          <Route path="/settings/document-sequences" element={<SequencesPage />} />
          <Route path="/settings/system" element={<SystemSettingsPage />} />
          <Route path="/settings/ai" element={<AISettingsPage />} />
          <Route path="/settings/audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
