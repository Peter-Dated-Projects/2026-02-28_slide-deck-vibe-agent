import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ProjectCard, ProjectData } from '../../components/dashboard/ProjectCard';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

// Mock generation for prototyping
const generateMockProjects = (count: number): ProjectData[] => {
  return Array.from({ length: count }).map((_, i) => {
    // Some are recent, some are older
    const isRecent = Math.random() > 0.6;
    const daysAgo = isRecent ? Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 30);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    return {
      id: `proj-${i}`,
      name: `Untitled Project ${i + 1}`,
      updatedAt: date.toISOString(),
      createdAt: date.toISOString(),
      theme: ['Professional', 'Creative', 'Minimal', 'Dark Mode'][Math.floor(Math.random() * 4)],
      thumbnailUrl: `https://picsum.photos/seed/${i + 1}/800/450`
    };
  });
};

const mockProjects = generateMockProjects(45);

export default function ProjectsPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4); // Default to 4

  // Setup ResizeObserver to calculate columns dynamically
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        // Calculation: min-width is 300px, gap is 24px (1.5rem)
        let cols = Math.floor((width + 24) / 324);
        if (cols < 1) cols = 1;
        setColumns(cols);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const itemsPerPage = Math.min(20, columns * 4);

  // Derived state
  const recentProjects = useMemo(() => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    return mockProjects
      .filter(p => new Date(p.updatedAt) >= threeDaysAgo)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5); // Keep top 5 most recent max
  }, []);

  const sortedAllProjects = useMemo(() => {
    return [...mockProjects].sort((a, b) => new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime());
  }, []);

  const totalPages = Math.ceil(sortedAllProjects.length / itemsPerPage);

  // Adjust current page if total pages decreases
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAllProjects.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAllProjects, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your presentations and slide decks.</p>
        </div>
        <button className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center gap-1.5 rounded-md transition-colors">
          <Plus className="h-4 w-4" />
          <span>New Project</span>
        </button>
      </div>

      {recentProjects.length > 0 && (
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-foreground mb-4">Recents</h2>
          <div className="relative">
            <div className="flex overflow-x-auto gap-6 pb-4 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {recentProjects.map(project => (
                <ProjectCard key={project.id} project={project} className="w-[300px] sm:w-[320px] max-h-[250px] shrink-0 snap-start" />
              ))}
              {/* Spacer empty div to allow scrolling past the fade overlay */}
              <div className="w-4 shrink-0" />
            </div>
            {/* Overlay gradient to simulate fade out without expensive mask-image paint */}
            <div className="absolute top-0 right-0 bottom-4 w-32 bg-gradient-to-l from-background to-transparent pointer-events-none" />
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">All Projects</h2>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {sortedAllProjects.length} Total
          </span>
        </div>

        <div ref={containerRef} className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 mb-8 auto-rows-max">
          {paginatedProjects.map(project => (
            <div key={project.id} className="min-w-0 flex items-stretch">
              <div className="w-full h-full flex items-stretch justify-start">
                <ProjectCard project={project} className="w-full" />
              </div>
            </div>
          ))}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="border border-input bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }).map((_, idx) => {
                const pageNum = idx + 1;
                // Simple logic to show current, first, last, and slightly around current
                if (
                  pageNum === 1 || 
                  pageNum === totalPages || 
                  (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                ) {
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`h-9 w-9 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ${
                        currentPage === pageNum
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-transparent bg-transparent hover:bg-muted text-foreground'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
                
                // Render ellipses
                if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                  return <span key={pageNum} className="px-1 text-muted-foreground">...</span>;
                }
                
                return null;
              })}
            </div>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="border border-input bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
