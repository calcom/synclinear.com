import { ChevronDownIcon, Cross1Icon } from "@radix-ui/react-icons";
import BaseSelect, { StylesConfig, components } from "react-select";

type SelectValue = { value: string; label: string };

type Props = {
    values: SelectValue[];
    onChange: (id: string) => void;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
};

const { ClearIndicator, DropdownIndicator } = components;

const styles: StylesConfig = {
    option: provided => ({
        ...provided,
        borderRadius: "2rem"
    }),
    control: provided => ({
        ...provided,
        borderRadius: "2rem",
        height: "3.5rem"
    }),
    container: provided => ({
        ...provided,
        width: "100%",
        maxWidth: "24rem"
    }),
    menu: provided => ({
        ...provided,
        borderRadius: "1.5rem",
        paddingLeft: "0.25rem",
        paddingRight: "0.25rem"
    }),
    placeholder: provided => ({
        ...provided,
        fontSize: "1.25rem",
        paddingLeft: "0.5rem"
    }),
    input: provided => ({
        ...provided,
        paddingLeft: "0.5rem"
    })
};

const Select: React.FC<Props> = ({
    values,
    onChange,
    placeholder = "Select a value",
    disabled,
    loading
}) => {
    return (
        <BaseSelect
            options={values}
            placeholder={placeholder}
            isDisabled={disabled}
            isLoading={loading}
            onChange={(selection: SelectValue) => onChange(selection?.value)}
            styles={styles}
            components={{
                ClearIndicator: props => (
                    <ClearIndicator {...props}>
                        <Cross1Icon className="w-5 h-5" />
                    </ClearIndicator>
                ),
                DropdownIndicator: props => (
                    <DropdownIndicator {...props}>
                        <ChevronDownIcon className="w-5 h-5" />
                    </DropdownIndicator>
                )
            }}
            isClearable
        />
    );
};

export default Select;

