import * as RadixTooltip from "@radix-ui/react-tooltip";

export default function Tooltip({ children, content }) {
    return (
        <RadixTooltip.Provider>
            <RadixTooltip.Root delayDuration={200}>
                <RadixTooltip.Trigger>{children}</RadixTooltip.Trigger>
                <RadixTooltip.Portal>
                    <RadixTooltip.Content
                        side="right"
                        sideOffset={5}
                        align="center"
                        className="text-gray-100 bg-gray-600 p-2 rounded-md text-sm"
                    >
                        {content}
                        <RadixTooltip.Arrow
                            offset={5}
                            width={11}
                            height={5}
                            className="fill-gray-700"
                        />
                    </RadixTooltip.Content>
                </RadixTooltip.Portal>
            </RadixTooltip.Root>
        </RadixTooltip.Provider>
    );
}

