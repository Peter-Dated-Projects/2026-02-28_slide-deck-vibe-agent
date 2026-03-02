import React, { useRef } from 'react';
import { TemplateCard } from '../../components/dashboard/TemplateCard';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Mock generation
const themes = [
  'Professional', 'Creative', 'Minimal', 'Dark Mode', 'Academic', 'Pitch Decks'
];

const mockTemplates = themes.map(theme => {
  return {
    theme,
    templates: Array.from({ length: 12 }).map((_, i) => ({
      id: `tmpl-${theme.toLowerCase()}-${i}`,
      name: `${theme} Deck ${i + 1}`,
      author: 'Vibe Design',
      thumbnailUrl: `https://picsum.photos/seed/${theme}${i + 1}/800/450`
    })),
  };
});

// A single scrollable row
const TemplateRow: React.FC<{ theme: string; templates: any[] }> = ({ theme, templates }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const amount = clientWidth * 0.75; // Scroll 75% of container width
      scrollRef.current.scrollTo({
        left: direction === 'left' ? scrollLeft - amount : scrollLeft + amount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="mb-10 last:mb-0 relative py-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-foreground">{theme}</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => scroll('left')}
            className="p-1.5 rounded-full border border-border bg-card/80 backdrop-blur shadow-sm hover:bg-muted hover:text-foreground text-muted-foreground transition-all z-10 hidden md:block"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button 
            onClick={() => scroll('right')}
            className="p-1.5 rounded-full border border-border bg-card/80 backdrop-blur shadow-sm hover:bg-muted hover:text-foreground text-muted-foreground transition-all z-10 hidden md:block"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      
      {/* Scrollable Container */}
      <div className="relative -mx-6 px-6 md:-mx-8 md:px-8">
        <div 
          ref={scrollRef}
          className="flex gap-6 overflow-x-auto pb-6 pt-2 snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {/* Hide scrollbar trick for Webkit in CSS normally, inline style for Firefox/IE */}
          <style>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          
          {templates.map(tmpl => (
            <TemplateCard key={tmpl.id} template={tmpl} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default function TemplatesPage() {
  return (
    <div className="max-w-7xl mx-auto pb-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">Start your next presentation with a professionally designed template.</p>
      </div>

      <div className="space-y-4">
        {mockTemplates.map(group => (
          <TemplateRow key={group.theme} theme={group.theme} templates={group.templates} />
        ))}
      </div>
    </div>
  );
}
