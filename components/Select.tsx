import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDownIcon, Cross1Icon } from "@radix-ui/react-icons";

type Props = {
    values: Array<{ id: string; name: string }>;
    onChange: (id: string) => void;
    chosenValue?: string;
    placeholder?: string;
    disabled?: boolean;
    action?: string;
    onAction?: () => void;
};

const Select: React.FC<Props> = ({
    values,
    onChange,
    chosenValue,
    placeholder = "Select a value",
    disabled,
    action,
    onAction
}) => {
    return (
        <RadixSelect.Root disabled={disabled} onValueChange={onChange}>
            <RadixSelect.Trigger className="border-2 bg-gray-100 border-gray-900 disabled:border-gray-400 overflow-hidden font-primary disabled:font-tertiary font-medium text-xl p-3 pl-1 h-14 w-full max-w-md rounded-[2rem] enabled:hover:rounded-2xl transition-rounded active:outline-none flex items-center justify-between gap-2">
                <RadixSelect.Value placeholder={placeholder} />
                <ChevronDownIcon className="w-6 h-6" />
            </RadixSelect.Trigger>
            <RadixSelect.Portal>
                <RadixSelect.Content
                    position="popper"
                    className="overflow-hidden bg-white border-2 border-gray-900 rounded-3xl"
                >
                    <RadixSelect.Viewport className="p-2">
                        {chosenValue ? (
                            <Cross1Icon
                                className="w-6 h-6 ml-auto p-1 hover:text-danger transition-colors cursor-pointer"
                                onClick={() => {
                                    onChange("");
                                }}
                            />
                        ) : null}
                        {values?.map(value => (
                            <RadixSelect.Item
                                key={value.id}
                                value={value.id}
                                className="h-8 flex items-center cursor-pointer hover:bg-gray-200 outline-none rounded-full relative px-4 select-none"
                            >
                                <RadixSelect.ItemText>
                                    {value.name}
                                </RadixSelect.ItemText>
                            </RadixSelect.Item>
                        ))}
                        {values.length === 0 && (
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
                    </RadixSelect.Viewport>
                    <RadixSelect.Arrow />
                </RadixSelect.Content>
            </RadixSelect.Portal>
        </RadixSelect.Root>
    );
};

export default Select;

