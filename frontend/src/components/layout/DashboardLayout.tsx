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
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
export const DashboardLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      <div className="flex-1 ml-[300px] min-h-screen flex flex-col relative overflow-x-hidden">
        {/* We can add a subtle background glow for aesthetics */}
        <div className="pointer-events-none fixed inset-0 flex justify-center overflow-hidden z-0">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] mix-blend-multiply opacity-50 dark:mix-blend-screen" />
          <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-accent/5 blur-[120px] mix-blend-multiply opacity-50 dark:mix-blend-screen" />
        </div>
        <main className="flex-1 relative z-10 w-full p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
