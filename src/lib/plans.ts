import { OrgSubscription, SubscriptionPlan, PlatformPlan } from '../types';

export interface PlanLimits {
  name: SubscriptionPlan;
  arabic_name: string;
  description: string;
  price_usd_monthly: string;
  max_invoices_per_month: number;
  max_members: number;
  max_customers: number;
  max_products: number;
  features: {
    advanced_reports: boolean;
    multi_currency: boolean;
    inventory_tracking: boolean;
    audit_trail: boolean;
    branches: boolean;
  };
}

export const PLAN_TIERS: Record<SubscriptionPlan, PlanLimits> = {
  Free: {
    name: 'Free',
    arabic_name: 'الباقة المجانية',
    description: 'للمتاجر الناشئة وصغار التجار لتجربة النظام وإدارة العمليات الأساسية',
    price_usd_monthly: 'مجاناً',
    max_invoices_per_month: 100,
    max_members: 2,
    max_customers: 25,
    max_products: 50,
    features: {
      advanced_reports: false,
      multi_currency: true,
      inventory_tracking: true,
      audit_trail: false,
      branches: false,
    },
  },
  Starter: {
    name: 'Starter',
    arabic_name: 'باقة المبتدئين',
    description: 'للمتاجر الصغيرة المتنامية مع دعم العملات المتعددة وتتبع سجل العمليات',
    price_usd_monthly: '$15/شهر',
    max_invoices_per_month: 100,
    max_members: 3,
    max_customers: 150,
    max_products: 300,
    features: {
      advanced_reports: false,
      multi_currency: true,
      inventory_tracking: true,
      audit_trail: true,
      branches: false,
    },
  },
  Professional: {
    name: 'Professional',
    arabic_name: 'الباقة الاحترافية',
    description: 'للمتاجر والشركات المتوسطة ذات النشاط المستمر والتقارير المالية المتقدمة',
    price_usd_monthly: '$35/شهر',
    max_invoices_per_month: 500,
    max_members: 10,
    max_customers: 1000,
    max_products: 2500,
    features: {
      advanced_reports: true,
      multi_currency: true,
      inventory_tracking: true,
      audit_trail: true,
      branches: false,
    },
  },
  Business: {
    name: 'Business',
    arabic_name: 'باقة الأعمال',
    description: 'للشركات والمتاجر الكبيرة متعددة الفروع والمستخدمين',
    price_usd_monthly: '$75/شهر',
    max_invoices_per_month: 2500,
    max_members: 25,
    max_customers: 5000,
    max_products: 10000,
    features: {
      advanced_reports: true,
      multi_currency: true,
      inventory_tracking: true,
      audit_trail: true,
      branches: true,
    },
  },
  Enterprise: {
    name: 'Enterprise',
    arabic_name: 'باقة الشركات الكبرى',
    description: 'حلول مخصصة بلا حدود للشركات القابضة والمؤسسات ذات الحجم الكبير',
    price_usd_monthly: 'مخصص',
    max_invoices_per_month: 999999,
    max_members: 999999,
    max_customers: 999999,
    max_products: 999999,
    features: {
      advanced_reports: true,
      multi_currency: true,
      inventory_tracking: true,
      audit_trail: true,
      branches: true,
    },
  },
};

export const DEFAULT_PLAN: SubscriptionPlan = 'Free';

export const createDefaultSubscription = (orgId: string): OrgSubscription => {
  const plan = PLAN_TIERS[DEFAULT_PLAN];
  const now = new Date().toISOString();
  return {
    plan_id: 'Free',
    max_invoices_total: 100,
    invoice_period: 'lifetime',
    effective_status: 'active',
    subscription_start: now,
    subscription_end: null,
    org_id: orgId,
    plan: plan.name,
    status: 'active',
    max_invoices_per_month: plan.max_invoices_per_month,
    max_members: plan.max_members,
    max_customers: plan.max_customers,
    max_products: plan.max_products,
    features: { ...plan.features },
    created_at: now,
    updated_at: now,
  };
};

/** Trusted defaults seed the editable platform catalog; tenant clients never activate plans. */
export function defaultPlatformPlans(now = new Date().toISOString()): PlatformPlan[] {
  const prices: Record<SubscriptionPlan, number> = { Free: 0, Starter: 15, Professional: 35, Business: 75, Enterprise: 0 };
  return (Object.values(PLAN_TIERS)).map(tier => ({
    id: tier.name, name: tier.arabic_name, description: tier.description, price: prices[tier.name], currency: 'USD',
    durationDays: tier.name === 'Free' ? 0 : 30,
    limits: { maxUsers: tier.max_members, maxBranches: tier.features.branches ? 25 : 1, maxWarehouses: tier.features.branches ? 25 : 1, maxInvoices: tier.max_invoices_per_month, invoicePeriod: tier.name === 'Free' ? 'lifetime' : 'month', maxCustomers: tier.max_customers, maxProducts: tier.max_products },
    features: { ...tier.features, accounting: true, warehouses: tier.features.branches },
    active: true, revision: 1, createdAt: now, updatedAt: now,
  }));
}

export function subscriptionLimits(subscription: OrgSubscription): PlanLimits {
  const fallback = getPlanConfig(subscription.plan);
  return { ...fallback, max_invoices_per_month: subscription.max_invoices_per_month, max_members: subscription.max_members, max_customers: subscription.max_customers ?? fallback.max_customers, max_products: subscription.max_products ?? fallback.max_products, features: { ...fallback.features, ...subscription.features } };
}

export const getPlanConfig = (planName?: SubscriptionPlan): PlanLimits => {
  if (planName && PLAN_TIERS[planName]) {
    return PLAN_TIERS[planName];
  }
  return PLAN_TIERS[DEFAULT_PLAN];
};

export const isUnlimited = (limit: number): boolean => {
  return limit >= 999990;
};

export const formatLimitLabel = (limit: number): string => {
  if (isUnlimited(limit)) {
    return 'غير محدود';
  }
  return limit.toLocaleString('ar-EG');
};
