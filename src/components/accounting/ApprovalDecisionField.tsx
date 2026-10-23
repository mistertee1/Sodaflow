import React from 'react';
import type { ApprovalCurrency, ApprovalPolicy, ApprovalSubject } from '../../domain/approvalPolicies';
import type { OrgRole } from '../../types';

const rank:Record<OrgRole,number>={Viewer:0,Cashier:1,Sales:1,Accountant:2,Admin:3,Owner:4};
export function approvalRequirement(policies:ApprovalPolicy[],subject:ApprovalSubject,currency:ApprovalCurrency,value:number,role:OrgRole){
  const policy=policies.find(row=>row.active&&row.subject===subject&&row.currency===currency);
  if(!policy||value<=0)return null;
  const tier=policy.tiers.find(row=>row.max_value===null||value<=row.max_value)!;
  return {policy,tier,allowed:rank[role]>=rank[tier.required_role]};
}
export function ApprovalDecisionField({requirement,reason,setReason}:{requirement:ReturnType<typeof approvalRequirement>;reason:string;setReason:(value:string)=>void}){
  if(!requirement)return null;
  return <div className={`rounded-xl border p-3 space-y-2 ${requirement.allowed?'border-sf-warning':'border-sf-danger'}`} data-testid="approval-decision">
    <p className="text-sm">هذه العملية تخضع لسياسة الاعتماد (الإصدار {requirement.policy.revision}) وتتطلب دور <b>{requirement.tier.required_role}</b>.</p>
    {!requirement.allowed?<p role="alert" className="text-sf-danger text-sm">دورك الحالي لا يملك مستوى الاعتماد المطلوب.</p>:<label className="block text-sm">سبب الاعتماد<textarea aria-label="سبب اعتماد العملية" required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="sf-field w-full"/></label>}
  </div>;
}
