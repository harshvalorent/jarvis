"use client";

import { useJarvisStore } from "@/lib/client/store";
import { SystemPanel } from "@/components/jarvis/system-panel";
import { FileTreePanel } from "@/components/jarvis/file-tree";
import { ActivityLogPanel } from "@/components/jarvis/activity-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Cpu, FolderOpen, ScrollText } from "lucide-react";

export function Sidebar() {
  const sender = useJarvisStore((s) => s.sender);

  const askJarvis = (text: string) => {
    sender?.(text);
    useJarvisStore.getState().setSidebarOpen(false);
  };

  return (
    <div className="scrollbar-hud h-full overflow-y-auto p-3">
      <Tabs defaultValue="system" className="w-full">
        <TabsList className="grid h-9 w-full grid-cols-3 border border-cyan-500/15 bg-[#060d18]">
          <TabsTrigger
            value="system"
            className="h-7 gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:text-zinc-200 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100"
          >
            <Cpu className="h-3 w-3" /> Sys
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="h-7 gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:text-zinc-200 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100"
          >
            <FolderOpen className="h-3 w-3" /> Files
          </TabsTrigger>
          <TabsTrigger
            value="log"
            className="h-7 gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:text-zinc-200 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-100"
          >
            <ScrollText className="h-3 w-3" /> Log
          </TabsTrigger>
        </TabsList>
        <TabsContent value="system" className="mt-3">
          <SystemPanel />
        </TabsContent>
        <TabsContent value="files" className="mt-3">
          <FileTreePanel onAskJarvis={askJarvis} />
        </TabsContent>
        <TabsContent value="log" className="mt-3">
          <ActivityLogPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
