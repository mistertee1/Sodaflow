import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  Timestamp,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  Organization,
  OrgMember,
  OrgInvitation,
  OrgRole,
  MerchantSettings,
  Customer,
  Product,
  Invoice,
  Payment,
  Expense,
  InventoryMovement,
  DEFAULT_ORGANIZATION_COUNTERS,
} from '../types';
import { createDefaultSubscription } from '../lib/plans';
import { logAuditEvent } from './auditService';

export const BACKEND_STATUS = 'BACKEND SERVER-AUTHORITATIVE OPERATIONS: NOT DEPLOYED';
export const EMAIL_STATUS = 'EMAIL DELIVERY: NOT PRODUCTION VERIFIED';
export const MONITORING_STATUS = 'EXTERNAL MONITORING: NOT DEPLOYED';
export const RATE_LIMIT_STATUS = 'CENTRALIZED SERVER RATE LIMITING: NOT DEPLOYED';

/**
 * Creates a default Organization document
 */
export const createOrganizationEntity = (
  orgId: string,
  ownerUid: string,
  settings: MerchantSettings,
  name?: string
): Organization => {
  const now = new Date().toISOString();
  return {
    id: orgId,
    name: name || settings.business_name || 'مؤسستي التجارية',
    display_name: settings.business_name || 'مؤسستي التجارية',
    business_activity: settings.business_activity || 'تجارة عامة وخدمات',
    commercial_registration: settings.commercial_registration || '',
    tax_number: settings.tax_number || '',
    base_currency: settings.primary_currency || 'SDG',
    secondary_currency: settings.secondary_currency || 'USD',
    timezone: settings.timezone || 'Africa/Khartoum',
    fiscal_year: settings.fiscal_year || new Date().getFullYear().toString(),
    status: 'active',
    owner_uid: ownerUid,
    schema_version: 2,
    settings,
    created_at: now,
    updated_at: now,
  };
};

/**
 * Load all organizations where the user is a member or owner
 */
export const getUserOrganizations = async (userId: string): Promise<Organization[]> => {
  const orgs: Organization[] = [];
  const seenOrgIds = new Set<string>();

  try {
    // 1. Direct index lookup in user_organizations
    try {
      const indexCol = collection(db, 'user_organizations', userId, 'orgs');
      const indexSnap = await getDocs(indexCol);

      for (const d of indexSnap.docs) {
        const orgId = d.id;
        try {
          const orgDoc = await getDoc(doc(db, 'organizations', orgId));
          if (orgDoc.exists() && !seenOrgIds.has(orgId)) {
            orgs.push(orgDoc.data() as Organization);
            seenOrgIds.add(orgId);
          }
        } catch (orgErr) {
          console.warn(`Could not load individual org ${orgId}:`, orgErr);
        }
      }
    } catch (indexErr) {
      console.warn('Index lookup in user_organizations caught:', indexErr);
    }

    // 2. Also check if the user has an organization with their standard ID (e.g. org-{uid})
    const defaultOrgId = `org-${userId}`;
    if (!seenOrgIds.has(defaultOrgId)) {
      try {
        const directOrgDoc = await getDoc(doc(db, 'organizations', defaultOrgId));
        if (directOrgDoc.exists() && !seenOrgIds.has(defaultOrgId)) {
          orgs.push(directOrgDoc.data() as Organization);
          seenOrgIds.add(defaultOrgId);
        }
      } catch (directErr) {
        console.warn('Direct org lookup caught:', directErr);
      }
    }

    // 3. Fallback: Query organizations collection where owner_uid == userId
    if (orgs.length === 0) {
      try {
        const q = query(collection(db, 'organizations'), where('owner_uid', '==', userId));
        const qSnap = await getDocs(q);
        for (const docSnap of qSnap.docs) {
          if (docSnap.exists() && !seenOrgIds.has(docSnap.id)) {
            orgs.push(docSnap.data() as Organization);
            seenOrgIds.add(docSnap.id);
          }
        }
      } catch (qErr) {
        console.warn('Owned organizations query fallback caught:', qErr);
      }
    }

    return orgs;
  } catch (err) {
    console.error('Error fetching user organizations:', err);
    return orgs;
  }
};

/**
 * Load members for an organization
 */
export const getOrganizationMembers = async (orgId: string): Promise<OrgMember[]> => {
  if (!orgId || orgId === 'local-guest-org') {
    return [];
  }
  try {
    const membersCol = collection(db, 'organizations', orgId, 'members');
    const snap = await getDocs(membersCol);
    return snap.docs.map((d) => d.data() as OrgMember);
  } catch (err: any) {
    console.warn('Notice while loading organization members:', err?.message || err);
    return [];
  }
};

/**
 * Add or update an organization member
 */
export const setOrganizationMember = async (
  orgId: string,
  member: OrgMember,
  actorUid: string,
  actorEmail: string
): Promise<void> => {
  const memberRef = doc(db, 'organizations', orgId, 'members', member.uid);
  await setDoc(memberRef, member, { merge: true });

  // Update user's index
  const indexRef = doc(db, 'user_organizations', member.uid, 'orgs', orgId);
  await setDoc(indexRef, { org_id: orgId, role: member.role, joined_at: member.joined_at }, { merge: true });

  await logAuditEvent(
    orgId,
    actorUid,
    actorEmail,
    'member:update_role',
    'member',
    member.uid,
    `تعيين دور العضو: ${member.email} إلى ${member.role}`
  );
};

/**
 * Remove an organization member
 */
export const removeOrganizationMember = async (
  orgId: string,
  memberUid: string,
  actorUid: string,
  actorEmail: string
): Promise<void> => {
  await deleteDoc(doc(db, 'organizations', orgId, 'members', memberUid));
  try {
    await deleteDoc(doc(db, 'user_organizations', memberUid, 'orgs', orgId));
  } catch (idxErr) {
    console.warn('Notice deleting from user_organizations index:', idxErr);
  }

  await logAuditEvent(
    orgId,
    actorUid,
    actorEmail,
    'member:remove',
    'member',
    memberUid,
    `إزالة العضو من المؤسسة`
  );
};

/**
 * Suspend an organization member
 */
export const suspendOrganizationMember = async (
  orgId: string,
  memberUid: string,
  actorUid: string,
  actorEmail: string
): Promise<void> => {
  const memberRef = doc(db, 'organizations', orgId, 'members', memberUid);
  await updateDoc(memberRef, { status: 'suspended' });

  await logAuditEvent(
    orgId,
    actorUid,
    actorEmail,
    'member:suspend',
    'member',
    memberUid,
    `تجميد/تعليق حساب العضو في المؤسسة`
  );
};

/**
 * Reactivate a suspended organization member
 */
export const reactivateOrganizationMember = async (
  orgId: string,
  memberUid: string,
  actorUid: string,
  actorEmail: string
): Promise<void> => {
  const memberRef = doc(db, 'organizations', orgId, 'members', memberUid);
  await updateDoc(memberRef, { status: 'active' });

  await logAuditEvent(
    orgId,
    actorUid,
    actorEmail,
    'member:reactivate',
    'member',
    memberUid,
    `إلغاء تجميد وتفعيل حساب العضو في المؤسسة`
  );
};

/**
 * Create a secure organization invitation
 */
export const createOrgInvitation = async (
  orgId: string,
  recipientEmail: string,
  role: OrgRole,
  actorUid: string,
  actorEmail: string
): Promise<OrgInvitation> => {
  const invId = 'inv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days validity

  const invitation: OrgInvitation = {
    id: invId,
    org_id: orgId,
    email: recipientEmail,
    role,
    token: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    invited_by: actorEmail || actorUid,
    status: 'pending',
  };

  const invDoc = {
    ...invitation,
    recipient_email: recipientEmail,
    inviter_uid: actorUid,
    expires_at_ts: Timestamp.fromDate(expiresAt),
    created_at_ts: Timestamp.fromDate(now),
  };

  await setDoc(doc(db, 'organizations', orgId, 'invitations', invId), invDoc);

  await logAuditEvent(
    orgId,
    actorUid,
    actorEmail,
    'invitation:create',
    'settings',
    invId,
    `إنشاء دعوة انضمام للبريد ${recipientEmail} بدور ${role}`
  );

  return invitation;
};

/**
 * Get all invitations for an organization
 */
export const getOrgInvitations = async (orgId: string): Promise<OrgInvitation[]> => {
  if (!orgId || orgId === 'local-guest-org') return [];
  try {
    const snap = await getDocs(collection(db, 'organizations', orgId, 'invitations'));
    return snap.docs.map((d) => d.data() as OrgInvitation);
  } catch (err: any) {
    console.warn('Notice while loading invitations:', err?.message || err);
    return [];
  }
};

/**
 * Revoke an invitation
 */
export const revokeOrgInvitation = async (
  orgId: string,
  invitationId: string,
  actorUid: string,
  actorEmail: string
): Promise<void> => {
  const invRef = doc(db, 'organizations', orgId, 'invitations', invitationId);
  await updateDoc(invRef, { status: 'revoked', updated_at: new Date().toISOString() });

  await logAuditEvent(
    orgId,
    actorUid,
    actorEmail,
    'invitation:revoke',
    'settings',
    invitationId,
    `إلغاء دعوة الانضمام #${invitationId}`
  );
};

/**
 * Accept an organization invitation
 */
export const acceptOrgInvitation = async (
  orgId: string,
  invitationId: string,
  recipientUid: string,
  recipientEmail: string,
  displayName: string
): Promise<OrgMember> => {
  const invRef = doc(db, 'organizations', orgId, 'invitations', invitationId);
  const memberRef = doc(db, 'organizations', orgId, 'members', recipientUid);
  const now = new Date();
  const nowIso = now.toISOString();

  // Atomic transaction ensures:
  // 1. Invitation existence, pending status, and expiration are verified
  // 2. Member document is created with active status
  // 3. Invitation status is transitioned to 'accepted' simultaneously (prevents reuse/race conditions)
  const newMember = await runTransaction(db, async (txn) => {
    const invSnap = await txn.get(invRef);

    if (!invSnap.exists()) {
      throw new Error('الدعوة غير موجودة');
    }

    const invData = invSnap.data() as OrgInvitation & { recipient_email?: string; expires_at_ts?: any };

    if (invData.status !== 'pending') {
      throw new Error('هذه الدعوة لم تعد صالحة للاستخدام (تم قبولها أو إلغاؤها سابقاً)');
    }

    const expiryDate = invData.expires_at_ts ? invData.expires_at_ts.toDate() : new Date(invData.expires_at);
    if (expiryDate < now) {
      throw new Error('انتهت صلاحية هذه الدعوة ولا يمكن قبولها');
    }

    const allowedEmail = invData.recipient_email || invData.email;
    if (allowedEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
      throw new Error('هذه الدعوة مخصصة لحساب بريد إلكتروني آخر');
    }

    const createdMember: OrgMember & { invitation_id?: string } = {
      uid: recipientUid,
      org_id: orgId,
      email: recipientEmail,
      display_name: displayName || recipientEmail.split('@')[0],
      role: invData.role,
      joined_at: nowIso,
      invited_by: invData.invited_by,
      status: 'active',
      invitation_id: invitationId,
    };

    txn.set(memberRef, createdMember);
    txn.update(invRef, {
      status: 'accepted',
      accepted_by: recipientUid,
      accepted_at: nowIso,
    });

    return createdMember;
  });

  // Register in user_organizations index for fast listing
  try {
    const indexRef = doc(db, 'user_organizations', recipientUid, 'orgs', orgId);
    await setDoc(indexRef, { org_id: orgId, role: newMember.role, joined_at: nowIso }, { merge: true });
  } catch (idxErr) {
    console.warn('Notice registering accepted org in user_organizations index:', idxErr);
  }

  await logAuditEvent(
    orgId,
    recipientUid,
    recipientEmail,
    'invitation:accept',
    'member',
    recipientUid,
    `قبول دعوة الانضمام للمؤسسة بدور ${newMember.role}`
  );

  return newMember;
};

/**
 * Create a new organization
 */
export const createOrganization = async (
  ownerUid: string,
  ownerEmail: string,
  name: string,
  settings: MerchantSettings
): Promise<Organization> => {
  const orgId = 'org-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const org = createOrganizationEntity(orgId, ownerUid, settings, name);
  const now = new Date().toISOString();

  // Write organization document
  await setDoc(doc(db, 'organizations', orgId), org);

  // Add owner member
  const ownerMember: OrgMember = {
    uid: ownerUid,
    org_id: orgId,
    email: ownerEmail,
    display_name: settings.business_name || 'المالك',
    role: 'Owner',
    joined_at: now,
    status: 'active',
  };
  await setDoc(doc(db, 'organizations', orgId, 'members', ownerUid), ownerMember);

  // Register in user_organizations index
  await setDoc(doc(db, 'user_organizations', ownerUid, 'orgs', orgId), {
    org_id: orgId,
    role: 'Owner',
    joined_at: now,
  });

  // Initialize subscription to default Free tier
  const defaultSub = createDefaultSubscription(orgId);
  await setDoc(doc(db, 'organizations', orgId, 'meta', 'subscription'), defaultSub);

  // Initialize counters document
  await setDoc(doc(db, 'organizations', orgId, 'meta', 'counters'), {
    ...DEFAULT_ORGANIZATION_COUNTERS,
    updated_at: now,
  });

  await logAuditEvent(
    orgId,
    ownerUid,
    ownerEmail,
    'org:create',
    'settings',
    orgId,
    `إنشاء مؤسسة تجارية جديدة: ${name}`
  );

  return org;
};

/**
 * Migration Service: Safely and non-destructively migrates data from /users/{userId} to /organizations/{orgId}
 * Preserves exact IDs, timestamps, FX rates, and data fields.
 * Idempotent, duplicate-safe, non-destructive.
 */
export const migrateUserToOrganization = async (
  userId: string,
  userEmail: string,
  currentSettings: MerchantSettings
): Promise<{ org: Organization; migratedCounts: Record<string, number> }> => {
  const orgId = `org-${userId}`;
  const now = new Date().toISOString();

  // Check if organization already exists
  const orgDocRef = doc(db, 'organizations', orgId);
  let orgDocSnap = null;
  try {
    orgDocSnap = await getDoc(orgDocRef);
  } catch (checkErr) {
    console.warn('Could not read existing organization doc, creating new one:', checkErr);
  }

  let org: Organization;
  if (orgDocSnap && orgDocSnap.exists()) {
    const existingData = orgDocSnap.data() as Organization;
    org = {
      ...createOrganizationEntity(orgId, userId, currentSettings),
      ...existingData,
      owner_uid: existingData.owner_uid || userId,
    };
  } else {
    org = createOrganizationEntity(orgId, userId, currentSettings);
  }

  try {
    await setDoc(orgDocRef, org, { merge: true });
  } catch (createErr) {
    console.warn('Could not write organization doc directly:', createErr);
  }

  // Ensure owner membership
  const ownerMember: OrgMember = {
    uid: userId,
    org_id: orgId,
    email: userEmail,
    display_name: currentSettings.business_name || 'المالك',
    role: 'Owner',
    joined_at: now,
    status: 'active',
  };
  try {
    const memberRef = doc(db, 'organizations', orgId, 'members', userId);
    await setDoc(memberRef, ownerMember, { merge: true });
  } catch (memberErr) {
    console.warn('Could not set organization member doc:', memberErr);
  }

  // Update user_organizations index
  try {
    await setDoc(
      doc(db, 'user_organizations', userId, 'orgs', orgId),
      { org_id: orgId, role: 'Owner', joined_at: now },
      { merge: true }
    );
  } catch (indexErr) {
    console.warn('Could not set user_organizations index:', indexErr);
  }

  const migratedCounts: Record<string, number> = {
    customers: 0,
    products: 0,
    invoices: 0,
    payments: 0,
    expenses: 0,
    movements: 0,
  };

  try {
    // 1. Customers
    const custSnap = await getDocs(collection(db, 'users', userId, 'customers'));
    for (const d of custSnap.docs) {
      const data = d.data() as Customer;
      await setDoc(
        doc(db, 'organizations', orgId, 'customers', d.id),
        { ...data, org_id: orgId, schema_version: 2 },
        { merge: true }
      );
      migratedCounts.customers++;
    }

    // 2. Products
    const prodSnap = await getDocs(collection(db, 'users', userId, 'products'));
    for (const d of prodSnap.docs) {
      const data = d.data() as Product;
      await setDoc(
        doc(db, 'organizations', orgId, 'products', d.id),
        { ...data, org_id: orgId, schema_version: 2 },
        { merge: true }
      );
      migratedCounts.products++;
    }

    // 3. Invoices
    const invSnap = await getDocs(collection(db, 'users', userId, 'invoices'));
    for (const d of invSnap.docs) {
      const data = d.data() as Invoice;
      await setDoc(
        doc(db, 'organizations', orgId, 'invoices', d.id),
        { ...data, org_id: orgId, schema_version: 2 },
        { merge: true }
      );
      migratedCounts.invoices++;
    }

    // 4. Payments
    const paySnap = await getDocs(collection(db, 'users', userId, 'payments'));
    for (const d of paySnap.docs) {
      const data = d.data() as Payment;
      await setDoc(
        doc(db, 'organizations', orgId, 'payments', d.id),
        { ...data, org_id: orgId, schema_version: 2 },
        { merge: true }
      );
      migratedCounts.payments++;
    }

    // 5. Expenses
    const expSnap = await getDocs(collection(db, 'users', userId, 'expenses'));
    for (const d of expSnap.docs) {
      const data = d.data() as Expense;
      await setDoc(
        doc(db, 'organizations', orgId, 'expenses', d.id),
        { ...data, org_id: orgId, schema_version: 2 },
        { merge: true }
      );
      migratedCounts.expenses++;
    }

    // 6. Inventory Movements
    const movSnap = await getDocs(collection(db, 'users', userId, 'inventory_movements'));
    for (const d of movSnap.docs) {
      const data = d.data() as InventoryMovement;
      await setDoc(
        doc(db, 'organizations', orgId, 'inventory_movements', d.id),
        { ...data, org_id: orgId, schema_version: 2 },
        { merge: true }
      );
      migratedCounts.movements++;
    }

    // Record migration record in meta
    await setDoc(
      doc(db, 'organizations', orgId, 'meta', 'migration'),
      {
        migrated_at: now,
        schema_version: 2,
        status: 'completed',
        migrated_counts: migratedCounts,
      },
      { merge: true }
    );

    await logAuditEvent(
      orgId,
      userId,
      userEmail,
      'migration:execute',
      'migration',
      orgId,
      `اكتمال ترحيل بيانات المستخدم إلى نطاق المؤسسة بنجاح v2.0`
    );
  } catch (err) {
    console.warn('Non-fatal error during migration copy:', err);
  }

  return { org, migratedCounts };
};
