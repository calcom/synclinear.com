import * as Select from "@radix-ui/react-select";
import { ChevronDownIcon, Cross1Icon } from "@radix-ui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
    values: Array<{ id: string; name: string }>;
    onChange: (id: string) => void;
    chosenValue?: string;
    placeholder?: string;
    disabled?: boolean;
    action?: string;
    onAction?: () => void;
};

const SelectWithSearch: React.FC<Props> = ({
    values,
    onChange,
    chosenValue,
    placeholder = "Select a value",
    disabled,
    action,
    onAction
}) => {
    const [filteredValues, setFilteredValues] = useState(values);
    const [query, setQuery] = useState("");

    useEffect(() => {
        setFilteredValues(_ => {
            if (query.length < 2) return values;

            return values?.filter(value =>
                value.name?.toLowerCase?.()?.includes?.(query.toLowerCase())
            );
        });

        // Hack to retain focus on text input
        setTimeout(() => refocusTextInput(), 10);
    }, [query, values]);

    const inputRef = useRef<HTMLInputElement>(null);

    const refocusTextInput = useCallback(
        () => inputRef?.current?.focus(),
        [inputRef]
    );

    return (
        <Select.Root
            disabled={disabled}
            onValueChange={(value: string) => {
                onChange(value);
                setQuery("");
            }}
            onOpenChange={() => {
                setTimeout(() => refocusTextInput(), 10);
            }}
        >
            <Select.Trigger className="border-2 bg-gray-100 border-gray-900 disabled:border-gray-400 overflow-hidden font-primary disabled:font-tertiary font-medium text-xl p-3 pl-1 h-14 w-full max-w-md rounded-[2rem] enabled:hover:rounded-2xl transition-rounded active:outline-none flex items-center justify-between gap-2">
                <Select.Value asChild>
                    <div className="flex gap-2 items-center justify-end">
                        <div className="rounded-full min-w-full group-hover:rounded-md bg-gray-200 px-3 py-2">
                            {query.length > 0
                                ? query
                                : chosenValue
                                ? chosenValue
                                : placeholder}
                        </div>
                    </div>
                </Select.Value>
                <ChevronDownIcon className="w-6 h-6" />
            </Select.Trigger>
            <Select.Portal>
                <Select.Content
                    position="popper"
                    className="overflow-hidden bg-white border-2 border-gray-900 rounded-3xl"
                >
                    <Select.Viewport className="p-2">
                        <input
                            type="text"
                            className="sr-only"
                            ref={inputRef}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                        {chosenValue || query.length > 0 ? (
                            <Cross1Icon
                                className="w-6 h-6 ml-auto p-1 hover:text-danger transition-colors cursor-pointer"
                                onClick={() => {
                                    setQuery("");
                                    onChange("");
                                }}
                            />
                        ) : null}
                        {filteredValues?.map(value => (
                            <Select.Item
                                onMouseLeave={refocusTextInput}
                                key={value.id}
                                value={value.id}
                                className="h-8 flex items-center cursor-pointer hover:bg-gray-200 outline-none rounded-full relative px-4 select-none"
                            >
                                <Select.ItemText>{value.name}</Select.ItemText>
                            </Select.Item>
                        ))}
                        {filteredValues.length === 0 && (
                            <div className="flex items-center px-2 justify-center h-8">
                                No results.
                            </div>
                        )}
                        {action && (
                            <div
                                onClick={onAction}
                                className="flex items-center px-2 justify-center h-8 hover:bg-gray-300 rounded-full cursor-pointer"
                            >
                                {action}
                            </div>
                        )}
                    </Select.Viewport>
                    <Select.Arrow />
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    );
};

export default SelectWithSearch;

