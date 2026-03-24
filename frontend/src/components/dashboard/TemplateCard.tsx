/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary 
 * information of Freedom, LLC ("Confidential Information"). You shall not 
 * disclose such Confidential Information and shall use it only in accordance 
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

import React from 'react';
import { Package } from 'lucide-react';
interface TemplateData {
  id: string;
  name: string;
  thumbnailUrl?: string;
  author: string;
}
export const TemplateCard: React.FC<{ template: TemplateData }> = ({ template }) => {
  return (
    <div className="group relative flex flex-col bg-card/60 backdrop-blur-xl border border-border rounded-xl shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden w-[300px] shrink-0 cursor-pointer snap-start">
      <div className="w-full aspect-video bg-muted relative overflow-hidden flex items-center justify-center group-hover:bg-muted/80 transition-colors pointer-events-none">
        {template.thumbnailUrl ? (
          <img src={template.thumbnailUrl} alt={template.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center justify-center opacity-30 text-muted-foreground">
            <Package className="h-12 w-12 mb-2" />
            <span className="text-xs font-medium tracking-wide">NO PREVIEW</span>
          </div>
        )}
      </div>
      <div className="p-4 flex items-start justify-between gap-4 border-t border-border/50 bg-card">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold leading-tight text-foreground truncate group-hover:text-primary transition-colors">
            {template.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            By {template.author}
          </p>
        </div>
      </div>
    </div>
  );
};
