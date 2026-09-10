'use client';

/**
 * Product knowledge — ACA and Medicare.
 *
 * Both are always accessible: there is deliberately no gate check on these
 * pages, so an agent can read either product's material at any point, including
 * before starting, and after failing a quiz.
 *
 * Both products are code-maintained interactive guides (AcaKnowledgeGuide and
 * MedicareKnowledgeGuide) built on the same GuideKit shell, so they are a
 * matched pair by construction: one directory listing, one screen per topic,
 * one three-question Quick Check under each screen, one palette.
 */

import { useParams, notFound } from 'next/navigation';
import AcaKnowledgeGuide from '@/components/knowledge/AcaKnowledgeGuide';
import MedicareKnowledgeGuide from '@/components/knowledge/MedicareKnowledgeGuide';

export default function KnowledgePage() {
  const params = useParams<{ campaign: string }>();
  const campaignParam = String(params.campaign ?? '').toLowerCase();

  if (campaignParam === 'medicare') return <MedicareKnowledgeGuide />;
  if (campaignParam === 'aca') return <AcaKnowledgeGuide />;
  notFound();
}
